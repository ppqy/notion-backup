import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { BackupPlan, BackupRunDetail, NotionObjectType, SelectedContent } from "../shared/types.js";
import { collectAssets, downloadAsset, type DownloadResult } from "./assets.js";
import { backupManifestMetadataForPlan } from "./backupManifest.js";
import { config } from "./config.js";
import { getNotionToken } from "./repositories/notionRepository.js";
import { duePlans, getPlan, setPlanNextRun, validateForManualRun } from "./repositories/planRepository.js";
import {
  claimNextQueuedRun,
  createBackupRun,
  createRunItem,
  getRun,
  markRunItemsCanceled,
  updateRun,
  updateRunItem
} from "./repositories/runRepository.js";
import { NotionApiError, NotionClient, ensureSupportedObjectType, type NotionObject } from "./notionClient.js";
import { extractTitle } from "./repositories/notionRepository.js";
import { directorySizeBytes, ensureBackupRoot, ensureRunDirs, runArtifactDir, writeJson, writeText } from "./storage.js";
import { RunLogger } from "./runLogger.js";
import { nowIso } from "./time.js";
import { nextRunAt } from "./schedule.js";
import { badRequest } from "./errors.js";

type PageBackupResult = {
  pageId: string;
  title: string;
  files: DownloadResult[];
  childPages: SelectedContent[];
};

type Manifest = {
  schemaVersion: number;
  capabilities: string[];
  artifactKinds: string[];
  runId: string;
  runKey: string;
  status: string;
  partial: boolean;
  plan: unknown;
  startedAt: string;
  finishedAt: string | null;
  items: Array<Record<string, unknown>>;
  skippedFiles: number;
};

class BackupCanceledError extends Error {
  constructor() {
    super("备份已取消");
  }
}

export class BackupWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(): void {
    ensureBackupRoot();
    this.timer = setInterval(() => {
      void this.tick();
    }, 5000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async enqueueManualRun(planId: string) {
    const plan = getPlan(planId);
    const missing = validateForManualRun(plan);
    if (missing.length > 0) {
      throw badRequest(missing.join("；"));
    }
    return createBackupRun(plan, "manual");
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.enqueueDueSchedules();
      let run = claimNextQueuedRun();
      while (run) {
        await this.executeRun(run);
        run = claimNextQueuedRun();
      }
    } finally {
      this.running = false;
    }
  }

  private async enqueueDueSchedules(): Promise<void> {
    for (const plan of duePlans()) {
      createBackupRun(plan, "scheduled");
      setPlanNextRun(plan.id, nextRunAt(plan.schedulePreset, plan.cronExpression, plan.timezone));
    }
  }

  private async executeRun(run: BackupRunDetail): Promise<void> {
    const token = getNotionToken();
    if (!token) {
      updateRun(run.id, {
        status: "failed",
        status_message: "Notion token 未配置",
        finished_at: nowIso()
      });
      return;
    }

    const plan = run.planSnapshot as BackupPlan;
    const runDir = runArtifactDir(run.runKey);
    ensureRunDirs(runDir);
    const logger = new RunLogger(runDir);
    const notion = new NotionClient(token, (event) => {
      void logger.write("warn", "notion_retry", event);
    });
    const manifest: Manifest = {
      ...backupManifestMetadataForPlan(plan),
      runId: run.id,
      runKey: run.runKey,
      status: "running",
      partial: false,
      plan,
      startedAt: nowIso(),
      finishedAt: null,
      items: [],
      skippedFiles: 0
    };
    const seenPages = new Set<string>();
    updateRun(run.id, {
      artifact_dir: runDir,
      current_phase: "备份中",
      total_items: plan.selectedContent.length
    });
    await logger.write("info", "run_started", { runId: run.id, planId: plan.id });

    try {
      for (const selected of plan.selectedContent) {
        if (this.cancelRequested(run.id)) {
          manifest.partial = true;
          await this.finishCanceled(run.id, manifest, runDir, logger);
          return;
        }
        const item = createRunItem(run.id, selected.objectId, selected.objectType, selected.title);
        updateRunItem(item.id, {
          status: "running",
          started_at: nowIso()
        });
        updateRun(run.id, {
          current_item_title: selected.title
        });

        try {
          const result = await this.backupSelected(run.id, notion, selected, plan, runDir, seenPages, logger);
          manifest.items.push({
            objectId: selected.objectId,
            objectType: selected.objectType,
            title: selected.title,
            status: "succeeded",
            result
          });
          manifest.skippedFiles += countSkipped(result);
          updateRunItem(item.id, {
            status: "succeeded",
            artifact_path: relativeToBackupRoot(resultPathFor(selected, runDir)),
            metadata_json: JSON.stringify(result),
            finished_at: nowIso()
          });
        } catch (error) {
          if (error instanceof BackupCanceledError) {
            throw error;
          }
          const message = errorMessage(error);
          manifest.partial = true;
          manifest.items.push({
            objectId: selected.objectId,
            objectType: selected.objectType,
            title: selected.title,
            status: "failed",
            error: message
          });
          await logger.write("error", "item_failed", { objectId: selected.objectId, error: message });
          updateRunItem(item.id, {
            status: "failed",
            error_message: message,
            finished_at: nowIso()
          });
          updateRun(run.id, {
            failed_items: getRun(run.id).failedItems + 1
          });
        }
        const current = getRun(run.id);
        updateRun(run.id, {
          processed_items: current.processedItems + 1,
          skipped_files: manifest.skippedFiles
        });
      }

      manifest.status = manifest.partial ? "partial_failed" : "succeeded";
      manifest.finishedAt = nowIso();
      await writeJson(path.join(runDir, "manifest.json"), manifest);
      updateRun(run.id, {
        status: manifest.partial ? "partial_failed" : "succeeded",
        status_message: manifest.partial ? "完成，但部分项目失败" : "备份完成",
        current_phase: "完成",
        current_item_title: null,
        artifact_size_bytes: directorySizeBytes(runDir),
        finished_at: manifest.finishedAt
      });
      await logger.write("info", "run_finished", { status: manifest.status });
    } catch (error) {
      if (error instanceof BackupCanceledError) {
        await this.finishCanceled(run.id, manifest, runDir, logger);
        return;
      }
      const message = errorMessage(error);
      manifest.status = "failed";
      manifest.partial = true;
      manifest.finishedAt = nowIso();
      await writeJson(path.join(runDir, "manifest.json"), manifest);
      await logger.write("error", "run_failed", { error: message });
      updateRun(run.id, {
        status: "failed",
        status_message: message,
        current_phase: "失败",
        current_item_title: null,
        artifact_size_bytes: existsSync(runDir) ? directorySizeBytes(runDir) : null,
        finished_at: manifest.finishedAt
      });
    }
  }

  private async backupSelected(
    runId: string,
    notion: NotionClient,
    selected: SelectedContent,
    plan: BackupPlan,
    runDir: string,
    seenPages: Set<string>,
    logger: RunLogger
  ): Promise<Record<string, unknown>> {
    this.ensureNotCanceled(runId);
    if (selected.objectType === "page") {
      return this.backupPage(runId, notion, selected.objectId, plan, runDir, seenPages, logger);
    }
    return this.backupDataSource(runId, notion, selected.objectId, plan, runDir, seenPages, logger);
  }

  private async backupDataSource(
    runId: string,
    notion: NotionClient,
    dataSourceId: string,
    plan: BackupPlan,
    runDir: string,
    seenPages: Set<string>,
    logger: RunLogger
  ): Promise<Record<string, unknown>> {
    this.ensureNotCanceled(runId);
    const dataSource = await notion.retrieveDataSource(dataSourceId);
    const entries: NotionObject[] = [];
    let startCursor: string | undefined;
    do {
      this.ensureNotCanceled(runId);
      const response = await notion.queryDataSource(dataSourceId, startCursor);
      entries.push(...response.results);
      startCursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (startCursor);
    const directory = path.join(runDir, "data-sources", dataSourceId);
    await mkdir(directory, { recursive: true });
    await writeJson(path.join(directory, "schema.json"), dataSource);
    const entryResults = [];
    for (const entry of entries) {
      this.ensureNotCanceled(runId);
      const pageId = String(entry.id);
      const result = await this.backupPage(runId, notion, pageId, plan, runDir, seenPages, logger, entry);
      entryResults.push(result);
    }
    await writeJson(path.join(directory, "entries.json"), entries);
    return {
      dataSourceId,
      title: extractTitle(dataSource),
      entries: entryResults.length,
      path: relativeToBackupRoot(directory)
    };
  }

  private async backupPage(
    runId: string,
    notion: NotionClient,
    pageId: string,
    plan: BackupPlan,
    runDir: string,
    seenPages: Set<string>,
    logger: RunLogger,
    knownPage?: NotionObject
  ): Promise<PageBackupResult> {
    this.ensureNotCanceled(runId);
    if (seenPages.has(pageId)) {
      return {
        pageId,
        title: "已去重页面",
        files: [],
        childPages: []
      };
    }
    seenPages.add(pageId);
    const page = knownPage ?? (await notion.retrievePage(pageId));
    this.ensureNotCanceled(runId);
    const propertyItems = await this.retrievePropertyItems(runId, notion, pageId, page, logger);
    this.ensureNotCanceled(runId);
    const blocks = await this.retrieveBlockTree(runId, notion, pageId);
    this.ensureNotCanceled(runId);
    const comments = plan.includeComments ? await safeOptional(() => notion.retrieveComments(pageId), logger, "comments_failed", pageId) : null;
    this.ensureNotCanceled(runId);
    const markdown = await safeOptional(() => notion.retrieveMarkdown(pageId), logger, "markdown_failed", pageId);
    const pageTitle = extractTitle(page);

    const pageArtifact = {
      page,
      propertyItems,
      blocks,
      comments,
      markdown
    };
    await writeJson(path.join(runDir, "pages", `${pageId}.json`), pageArtifact);
    if (markdown) {
      await writeText(path.join(runDir, "markdown", `${pageId}.md`), extractMarkdownText(markdown));
    }

    this.ensureNotCanceled(runId);
    const files = await this.downloadAssetsForPage(runId, pageId, pageArtifact, plan, runDir, logger);
    const childPages = findChildPages(blocks);
    if (plan.includeChildPages) {
      for (const child of childPages) {
        this.ensureNotCanceled(runId);
        await this.backupPage(runId, notion, child.objectId, plan, runDir, seenPages, logger);
      }
    }
    return {
      pageId,
      title: pageTitle,
      files,
      childPages
    };
  }

  private async retrievePropertyItems(runId: string, notion: NotionClient, pageId: string, page: NotionObject, logger: RunLogger): Promise<Record<string, unknown>> {
    const properties = page.properties as Record<string, { id?: string }> | undefined;
    if (!properties) {
      return {};
    }
    const result: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(properties)) {
      this.ensureNotCanceled(runId);
      if (!property.id) {
        continue;
      }
      try {
        result[name] = await notion.retrievePageProperty(pageId, property.id);
      } catch (error) {
        await logger.write("warn", "property_item_failed", {
          pageId,
          property: name,
          error: errorMessage(error)
        });
      }
    }
    return result;
  }

  private async retrieveBlockTree(runId: string, notion: NotionClient, blockId: string): Promise<NotionObject[]> {
    const blocks: NotionObject[] = [];
    let startCursor: string | undefined;
    do {
      this.ensureNotCanceled(runId);
      const response = await notion.listBlockChildren(blockId, startCursor);
      for (const block of response.results) {
        this.ensureNotCanceled(runId);
        const hasChildren = block.has_children === true;
        if (hasChildren) {
          block.children = await this.retrieveBlockTree(runId, notion, String(block.id));
        }
        blocks.push(block);
      }
      startCursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (startCursor);
    return blocks;
  }

  private async downloadAssetsForPage(
    runId: string,
    pageId: string,
    artifact: unknown,
    plan: BackupPlan,
    runDir: string,
    logger: RunLogger
  ): Promise<DownloadResult[]> {
    const candidates = collectAssets(artifact).filter((candidate) => {
      if (candidate.kind === "notion") {
        return plan.downloadNotionFiles;
      }
      return plan.mirrorExternalFiles;
    });
    const outputDir = path.join(runDir, "assets", pageId);
    const results: DownloadResult[] = [];
    for (const candidate of candidates) {
      this.ensureNotCanceled(runId);
      const result = await downloadAsset(candidate, outputDir, plan.fileSizeLimitBytes);
      results.push(result);
      if (result.status === "skipped") {
        await logger.write("warn", "asset_skipped", {
          pageId,
          url: candidate.url,
          reason: result.reason
        });
      }
    }
    await writeJson(path.join(outputDir, "manifest.json"), results);
    return results;
  }

  private cancelRequested(runId: string): boolean {
    return getRun(runId).status === "cancel_requested";
  }

  private ensureNotCanceled(runId: string): void {
    if (this.cancelRequested(runId)) {
      throw new BackupCanceledError();
    }
  }

  private async finishCanceled(runId: string, manifest: Manifest, runDir: string, logger: RunLogger): Promise<void> {
    manifest.status = "canceled";
    manifest.partial = true;
    manifest.finishedAt = nowIso();
    await writeJson(path.join(runDir, "manifest.json"), manifest);
    await logger.write("warn", "run_canceled", { runId });
    markRunItemsCanceled(runId, "用户取消，未完成");
    updateRun(runId, {
      status: "canceled",
      status_message: "用户已取消，已写入的备份文件保留",
      current_phase: "已取消",
      current_item_title: null,
      artifact_size_bytes: directorySizeBytes(runDir),
      finished_at: manifest.finishedAt
    });
  }
}

function countSkipped(value: unknown): number {
  if (!value || typeof value !== "object") {
    return 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countSkipped(item), 0);
  }
  const record = value as Record<string, unknown>;
  let total = record.status === "skipped" ? 1 : 0;
  for (const item of Object.values(record)) {
    total += countSkipped(item);
  }
  return total;
}

function findChildPages(blocks: NotionObject[]): SelectedContent[] {
  const children: SelectedContent[] = [];
  for (const block of blocks) {
    if (block.type === "child_page") {
      const childPage = block.child_page as { title?: string } | undefined;
      children.push({
        objectId: String(block.id),
        objectType: "page",
        title: childPage?.title || "子页面"
      });
    }
    if (Array.isArray(block.children)) {
      children.push(...findChildPages(block.children as NotionObject[]));
    }
  }
  return children;
}

function extractMarkdownText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  for (const key of ["markdown", "content", "text"]) {
    if (typeof record[key] === "string") {
      return record[key] as string;
    }
  }
  return JSON.stringify(value, null, 2);
}

async function safeOptional<T>(fn: () => Promise<T>, logger: RunLogger, event: string, pageId: string): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    await logger.write("warn", event, {
      pageId,
      error: errorMessage(error)
    });
    return null;
  }
}

function resultPathFor(selected: SelectedContent, runDir: string): string {
  if (selected.objectType === "page") {
    return path.join(runDir, "pages", `${selected.objectId}.json`);
  }
  return path.join(runDir, "data-sources", selected.objectId);
}

function relativeToBackupRoot(filePath: string): string {
  return path.relative(config.backupRoot, filePath);
}

function errorMessage(error: unknown): string {
  if (error instanceof NotionApiError) {
    return `${error.status} ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "未知错误";
}

export async function validateObjectAccess(notion: NotionClient, objectId: string): Promise<{ object: NotionObject; objectType: NotionObjectType }> {
  try {
    const page = await notion.retrievePage(objectId);
    return { object: page, objectType: ensureSupportedObjectType(page) };
  } catch {
    const dataSource = await notion.retrieveDataSource(objectId);
    return { object: dataSource, objectType: ensureSupportedObjectType(dataSource) };
  }
}

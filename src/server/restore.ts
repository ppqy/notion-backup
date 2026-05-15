import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { BackupRunDetail, BackupRunItem, NotionObjectType, RestorePreflight, RestoreReport, RestoreStatus, RestoreWarning } from "../shared/types.js";
import type { DownloadResult } from "./assets.js";
import { badRequest, notFound } from "./errors.js";
import { NotionApiError, NotionClient, type NotionObject } from "./notionClient.js";
import { extractTitle } from "./repositories/notionRepository.js";
import { getRun } from "./repositories/runRepository.js";
import { writeJson } from "./storage.js";
import { nowIso } from "./time.js";

type PageArtifact = {
  page: NotionObject;
  propertyItems?: Record<string, unknown>;
  blocks: NotionObject[];
  comments?: unknown;
  markdown?: unknown;
};

type RestoreParent =
  | {
      type: "page_id";
      page_id: string;
    }
  | {
      type: "data_source_id";
      data_source_id: string;
      allowedPropertyNames?: Set<string>;
    };

type BlockConversion =
  | {
      action: "append";
      request: NotionObject;
      childBlocks: NotionObject[];
      warnings: RestoreWarning[];
    }
  | {
      action: "restore_child_page";
      childPageId: string;
      title: string;
      warnings: RestoreWarning[];
    }
  | {
      action: "skip";
      warnings: RestoreWarning[];
    };

type RestoredFilePayload = {
  type: "file_upload";
  file_upload: {
    id: string;
  };
};

type FileUploadResolver = (file: NotionObject, warnings: RestoreWarning[]) => RestoredFilePayload | null;

type RestoreContext = {
  notion: NotionClient;
  runDir: string;
  report: RestoreReport;
  restoringPages: Set<string>;
  assetManifests: Map<string, DownloadResult[] | null>;
  uploadedFiles: Map<string, RestoredFilePayload>;
  shouldCancel?: () => boolean;
  onProgress?: (report: RestoreReport) => void | Promise<void>;
};

export type RestoreExecutionHooks = {
  restoreId?: string;
  shouldCancel?: () => boolean;
  onPhase?: (phase: string, currentItemTitle?: string | null) => void | Promise<void>;
  onItemStart?: (item: BackupRunItem) => void | Promise<void>;
  onItemFinish?: (item: BackupRunItem, result: { status: "succeeded" | "failed" | "skipped"; newPageId?: string; newDataSourceId?: string; warningCount: number; error?: string }) => void | Promise<void>;
  onProgress?: (report: RestoreReport) => void | Promise<void>;
};

export class RestoreCanceledError extends Error {
  constructor() {
    super("恢复已取消");
  }
}

const RESTORE_LATEST_FILE = "restore-latest.json";
const RESTORE_CHILD_CHUNK_SIZE = 100;
const SINGLE_PART_FILE_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
const READ_ONLY_PAGE_PROPERTY_TYPES = new Set(["created_by", "created_time", "last_edited_by", "last_edited_time", "formula", "rollup", "unique_id", "verification"]);
const UNSUPPORTED_SCHEMA_PROPERTY_TYPES = new Set(["relation", "rollup", "formula", "button", "location", "verification", "last_visited_time"]);

export async function restoreRunToNotion(input: { runId: string; targetParentId: string; token: string }): Promise<RestoreReport> {
  return executeRestoreToNotion(input);
}

export async function executeRestoreToNotion(input: { runId: string; targetParentId: string; token: string; hooks?: RestoreExecutionHooks }): Promise<RestoreReport> {
  const run = getRun(input.runId);
  await validateRestorePreflight(run);
  const runDir = run.artifactDir;
  if (!runDir) {
    throw notFound("备份文件不存在");
  }

  const notion = new NotionClient(input.token);
  await validateRestoreTarget(notion, input.targetParentId);

  const restoreId = input.hooks?.restoreId ?? `${nowIso().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z")}_${nanoid(6)}`;
  const report = createInitialReport(restoreId, run.id, run.runKey, input.targetParentId);
  const context: RestoreContext = {
    notion,
    runDir,
    report,
    restoringPages: new Set(),
    assetManifests: new Map(),
    uploadedFiles: new Map(),
    shouldCancel: input.hooks?.shouldCancel,
    onProgress: input.hooks?.onProgress
  };

  try {
    await input.hooks?.onPhase?.("恢复中", null);
    for (const item of run.items) {
      assertRestoreNotCanceled(context);
      await input.hooks?.onItemStart?.(item);
      if (item.status !== "succeeded") {
        const result = addSkippedItem(report, item, "只恢复状态为成功的备份项目");
        await input.hooks?.onItemFinish?.(item, { status: "skipped", warningCount: result.warnings.length });
        await emitProgress(context);
        continue;
      }
      const itemWarningsStart = report.warnings.length;
      try {
        await input.hooks?.onPhase?.("恢复中", item.title);
        if (item.objectType === "data_source") {
          const newDataSourceId = await restoreDataSourceArtifact(context, item.objectId, input.targetParentId, item.title);
          const warnings = report.warnings.slice(itemWarningsStart);
          report.items.push({
            objectId: item.objectId,
            objectType: item.objectType,
            title: item.title,
            status: "succeeded",
            newDataSourceId,
            warnings
          });
          await input.hooks?.onItemFinish?.(item, { status: "succeeded", newDataSourceId, warningCount: warnings.length });
          await emitProgress(context);
          continue;
        }

        const newPageId = await restorePageArtifact(context, item.objectId, { type: "page_id", page_id: input.targetParentId }, item.title);
        const warnings = report.warnings.slice(itemWarningsStart);
        report.items.push({
          objectId: item.objectId,
          objectType: item.objectType,
          title: item.title,
          status: "succeeded",
          newPageId,
          warnings
        });
        await input.hooks?.onItemFinish?.(item, { status: "succeeded", newPageId, warningCount: warnings.length });
        await emitProgress(context);
      } catch (error) {
        if (error instanceof RestoreCanceledError) {
          const message = "用户取消恢复，当前项目可能只完成部分内容";
          report.errors.push(message);
          report.items.push({
            objectId: item.objectId,
            objectType: item.objectType,
            title: item.title,
            status: "failed",
            warnings: report.warnings.slice(itemWarningsStart),
            error: message
          });
          await input.hooks?.onItemFinish?.(item, { status: "failed", warningCount: report.warnings.length - itemWarningsStart, error: message });
          throw error;
        }
        const message = errorMessage(error);
        report.errors.push(message);
        report.items.push({
          objectId: item.objectId,
          objectType: item.objectType,
          title: item.title,
          status: "failed",
          warnings: report.warnings.slice(itemWarningsStart),
          error: message
        });
        await input.hooks?.onItemFinish?.(item, { status: "failed", warningCount: report.warnings.length - itemWarningsStart, error: message });
        await emitProgress(context);
      }
    }
  } catch (error) {
    if (!(error instanceof RestoreCanceledError)) {
      throw error;
    }
    finishReport(report, "canceled");
    await persistRestoreReport(runDir, report);
    return report;
  }

  finishReport(report);
  await persistRestoreReport(runDir, report);
  return report;
}

export async function preflightRestoreRun(input: { runId: string; targetParentId: string; token: string }): Promise<RestorePreflight> {
  const run = getRun(input.runId);
  await validateRestorePreflight(run);
  const runDir = run.artifactDir;
  if (!runDir) {
    throw notFound("备份文件不存在");
  }
  const notion = new NotionClient(input.token);
  await validateRestoreTarget(notion, input.targetParentId);
  return summarizeRestorePreflight(run, input.targetParentId);
}

export function summarizeRestorePreflight(run: Pick<BackupRunDetail, "id" | "runKey" | "artifactDir" | "items">, targetParentId: string): RestorePreflight {
  const runDir = run.artifactDir ?? "";
  const warnings: RestoreWarning[] = [];
  let pages = 0;
  let dataSources = 0;
  let restorableItems = 0;
  let skippedItems = 0;
  for (const item of run.items) {
    if (item.status !== "succeeded") {
      skippedItems += 1;
      warnings.push({
        code: "restore_item_skipped",
        message: `备份项目不是成功状态，恢复时会跳过：${item.title}`,
        objectId: item.objectId
      });
      continue;
    }
    restorableItems += 1;
    if (item.objectType === "page") {
      pages += 1;
      if (!existsSync(pageArtifactPath(runDir, item.objectId))) {
        warnings.push({
          code: "page_artifact_missing",
          message: `页面备份文件不存在，恢复时会失败：${item.title}`,
          objectId: item.objectId
        });
      }
      continue;
    }
    dataSources += 1;
    if (!existsSync(path.join(dataSourceArtifactPath(runDir, item.objectId), "schema.json"))) {
      warnings.push({
        code: "data_source_schema_missing",
        message: `数据源 schema 备份文件不存在，恢复时会失败：${item.title}`,
        objectId: item.objectId
      });
    }
    if (!existsSync(path.join(dataSourceArtifactPath(runDir, item.objectId), "entries.json"))) {
      warnings.push({
        code: "data_source_entries_missing",
        message: `数据源 entries 备份文件不存在，恢复时会失败：${item.title}`,
        objectId: item.objectId
      });
    }
  }
  warnings.push({
    code: "restore_creates_new_content",
    message: "恢复会创建新的 Notion 页面和数据源，不会覆盖或回滚原内容"
  });
  return {
    sourceRunId: run.id,
    sourceRunKey: run.runKey,
    targetParentId,
    totalItems: run.items.length,
    restorableItems,
    skippedItems,
    pages,
    dataSources,
    warnings
  };
}

export async function validateRestorePreflight(run: Pick<BackupRunDetail, "artifactDir" | "status" | "items">): Promise<void> {
  if (!run.artifactDir || !existsSync(run.artifactDir)) {
    throw notFound("备份文件不存在");
  }
  if (!["succeeded", "partial_failed"].includes(run.status)) {
    throw badRequest("只有成功或部分失败的备份运行可以恢复");
  }
  const backupManifest = path.join(run.artifactDir, "manifest.json");
  if (!existsSync(backupManifest)) {
    throw notFound("manifest 不存在，无法恢复");
  }
  await readJson<unknown>(backupManifest).catch(() => {
    throw badRequest("manifest 格式无效，无法恢复");
  });
  if (!run.items.some((item) => item.status === "succeeded")) {
    throw badRequest("没有可恢复的成功备份项目");
  }
}

export async function getLatestRestoreReport(runId: string): Promise<RestoreReport | null> {
  const run = getRun(runId);
  if (!run.artifactDir) {
    return null;
  }
  const latestPath = path.join(run.artifactDir, RESTORE_LATEST_FILE);
  if (!existsSync(latestPath)) {
    return null;
  }
  return readJson<RestoreReport>(latestPath).catch(() => null);
}

async function restoreDataSourceArtifact(context: RestoreContext, dataSourceId: string, targetParentId: string, fallbackTitle?: string): Promise<string> {
  assertRestoreNotCanceled(context);
  if (context.report.mappings.dataSources[dataSourceId]) {
    return context.report.mappings.dataSources[dataSourceId];
  }
  const schema = await readDataSourceSchema(context.runDir, dataSourceId);
  const entries = await readDataSourceEntries(context.runDir, dataSourceId);
  const schemaConversion = convertDataSourcePropertiesForRestore(schema.properties, dataSourceId);
  for (const warning of schemaConversion.warnings) {
    addWarning(context.report, warning);
  }

  const iconWarnings: RestoreWarning[] = [];
  const coverWarnings: RestoreWarning[] = [];
  const icon = sanitizeIcon(schema.icon, iconWarnings);
  const cover = sanitizePageCover(schema.cover, coverWarnings);
  if (schema.icon && !icon) {
    addWarning(context.report, {
      code: "data_source_icon_skipped",
      message: "数据源图标不是可直接恢复的 emoji/icon/custom_emoji/external 格式，已跳过",
      objectId: dataSourceId
    });
  }
  if (schema.cover && !cover) {
    addWarning(context.report, {
      code: "data_source_cover_skipped",
      message: "数据源封面不是可直接恢复的 external 格式，已跳过",
      objectId: dataSourceId
    });
  }

  const titleRichText = sanitizeRichTextArray(schema.title, context.report.warnings);
  const descriptionRichText = sanitizeRichTextArray(schema.description, context.report.warnings);
  const created = await context.notion.createDatabase({
    parent: {
      type: "page_id",
      page_id: targetParentId
    },
    title: titleRichText.length > 0 ? titleRichText : textRichText(fallbackTitle || extractTitle(schema) || "恢复数据源"),
    ...(descriptionRichText.length > 0 ? { description: descriptionRichText } : {}),
    ...(typeof schema.is_inline === "boolean" ? { is_inline: schema.is_inline } : {}),
    initial_data_source: {
      properties: schemaConversion.properties
    },
    ...(icon ? { icon } : {}),
    ...(cover ? { cover } : {})
  });
  const newDataSourceId = extractCreatedDataSourceId(created);
  if (!newDataSourceId) {
    throw new Error("Notion 未返回新数据源 ID");
  }
  context.report.mappings.dataSources[dataSourceId] = newDataSourceId;
  context.report.summary.createdDataSources += 1;

  const parent: RestoreParent = {
    type: "data_source_id",
    data_source_id: newDataSourceId,
    allowedPropertyNames: new Set(Object.keys(schemaConversion.properties))
  };
  for (const entry of entries) {
    assertRestoreNotCanceled(context);
    const entryPageId = String(entry.id ?? "");
    if (!entryPageId) {
      addWarning(context.report, {
        code: "data_source_entry_id_missing",
        message: "数据源条目缺少页面 ID，已跳过",
        objectId: dataSourceId
      });
      continue;
    }
    try {
      await restorePageArtifact(context, entryPageId, parent, extractTitle(entry));
    } catch (error) {
      const message = `数据源条目恢复失败：${entryPageId}：${errorMessage(error)}`;
      context.report.errors.push(message);
      addWarning(context.report, {
        code: "data_source_entry_restore_failed",
        message,
        objectId: dataSourceId,
        details: {
          entryPageId
        }
      });
    }
  }

  return newDataSourceId;
}

async function restorePageArtifact(context: RestoreContext, pageId: string, parent: RestoreParent, fallbackTitle?: string): Promise<string> {
  assertRestoreNotCanceled(context);
  if (context.report.mappings.pages[pageId]) {
    return context.report.mappings.pages[pageId];
  }
  if (context.restoringPages.has(pageId)) {
    addWarning(context.report, {
      code: "page_cycle_skipped",
      message: "检测到循环子页面引用，已跳过",
      objectId: pageId
    });
    return parent.type === "page_id" ? parent.page_id : parent.data_source_id;
  }
  context.restoringPages.add(pageId);
  try {
    const artifact = await readPageArtifact(context.runDir, pageId);
    const pageWarnings =
      parent.type === "page_id" ? collectPageArtifactRestoreWarnings(artifact, pageId) : collectPageCommentsRestoreWarnings(artifact, pageId);
    for (const warning of pageWarnings) {
      addWarning(context.report, warning);
    }
    const title = extractTitle(artifact.page) || fallbackTitle || "恢复页面";
    const createBody = await createPageBody(context, parent, artifact, title, pageId);
    assertRestoreNotCanceled(context);
    const restoredPage = await context.notion.createPage(createBody);
    const restoredPageId = String(restoredPage.id ?? "");
    if (!restoredPageId) {
      throw new Error("Notion 未返回新页面 ID");
    }
    context.report.mappings.pages[pageId] = restoredPageId;
    context.report.summary.createdPages += 1;
    await appendBlocks(context, restoredPageId, artifact.blocks, pageId);
    return restoredPageId;
  } finally {
    context.restoringPages.delete(pageId);
  }
}

async function appendBlocks(context: RestoreContext, parentBlockId: string, blocks: NotionObject[], sourcePageId: string): Promise<void> {
  const entries: Array<{ oldBlockId: string; request: NotionObject; childBlocks: NotionObject[] }> = [];
  const flushEntries = async () => {
    for (let index = 0; index < entries.length; index += RESTORE_CHILD_CHUNK_SIZE) {
      const chunk = entries.slice(index, index + RESTORE_CHILD_CHUNK_SIZE);
      await appendBlockChunk(context, parentBlockId, chunk, sourcePageId);
    }
    entries.length = 0;
  };

  for (const block of blocks) {
    assertRestoreNotCanceled(context);
    const oldBlockId = String(block.id ?? "");
    const rawChildBlocks = Array.isArray(block.children) ? (block.children as NotionObject[]) : [];
    const conversion = await convertBlockForRestoreWithAssets(context, block, sourcePageId);
    for (const warning of conversion.warnings) {
      addWarning(context.report, {
        ...warning,
        objectId: warning.objectId || sourcePageId,
        blockId: warning.blockId || oldBlockId || undefined
      });
    }
    if (conversion.action === "restore_child_page") {
      await flushEntries();
      const childArtifactPath = pageArtifactPath(context.runDir, conversion.childPageId);
      if (existsSync(childArtifactPath)) {
        await restorePageArtifact(context, conversion.childPageId, { type: "page_id", page_id: parentBlockId }, conversion.title);
      } else {
        addWarning(context.report, {
          code: "child_page_artifact_missing",
          message: `子页面备份文件不存在，已跳过：${conversion.title}`,
          objectId: sourcePageId,
          blockId: oldBlockId || undefined
        });
      }
      continue;
    }
    if (conversion.action === "append") {
      entries.push({
        oldBlockId,
        request: conversion.request,
        childBlocks: conversion.childBlocks
      });
      continue;
    }
    if (rawChildBlocks.length > 0) {
      await flushEntries();
      await appendBlocks(context, parentBlockId, rawChildBlocks, sourcePageId);
    }
  }

  await flushEntries();
}

async function appendBlockChunk(
  context: RestoreContext,
  parentBlockId: string,
  entries: Array<{ oldBlockId: string; request: NotionObject; childBlocks: NotionObject[] }>,
  sourcePageId: string
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  assertRestoreNotCanceled(context);
  try {
    const response = await context.notion.appendBlockChildren(
      parentBlockId,
      entries.map((entry) => entry.request)
    );
    await appendReturnedChildren(context, response.results, entries, sourcePageId);
  } catch (error) {
    if (entries.length === 1) {
      addWarning(context.report, {
        code: "block_append_failed",
        message: `区块恢复失败：${errorMessage(error)}`,
        objectId: sourcePageId,
        blockId: entries[0]?.oldBlockId || undefined
      });
      return;
    }
    for (const entry of entries) {
      await appendBlockChunk(context, parentBlockId, [entry], sourcePageId);
    }
  }
}

async function appendReturnedChildren(
  context: RestoreContext,
  results: NotionObject[],
  entries: Array<{ oldBlockId: string; request: NotionObject; childBlocks: NotionObject[] }>,
  sourcePageId: string
): Promise<void> {
  for (const [index, entry] of entries.entries()) {
    assertRestoreNotCanceled(context);
    const restored = results[index];
    const newBlockId = restored ? String(restored.id ?? "") : "";
    if (!newBlockId) {
      addWarning(context.report, {
        code: "block_mapping_missing",
        message: "Notion 未返回新 block ID，子区块未恢复",
        objectId: sourcePageId,
        blockId: entry.oldBlockId || undefined
      });
      continue;
    }
    if (entry.oldBlockId) {
      context.report.mappings.blocks[entry.oldBlockId] = newBlockId;
    }
    context.report.summary.createdBlocks += 1;
    if (entry.childBlocks.length > 0) {
      await appendBlocks(context, newBlockId, entry.childBlocks, sourcePageId);
    }
  }
}

async function convertBlockForRestoreWithAssets(context: RestoreContext, block: NotionObject, sourcePageId: string): Promise<BlockConversion> {
  const type = typeof block.type === "string" ? block.type : "";
  const payload = getPayload(block, type);
  const fileResolver = await prepareFileUploadResolver(context, sourcePageId, mediaPayloadNeedsUpload(type, payload) ? [payload] : []);
  return convertBlockForRestore(block, { fileResolver });
}

export function convertBlockForRestore(block: NotionObject, options: { fileResolver?: FileUploadResolver } = {}): BlockConversion {
  const type = typeof block.type === "string" ? block.type : "";
  const oldBlockId = typeof block.id === "string" ? block.id : undefined;
  const payload = getPayload(block, type);
  const childBlocks = Array.isArray(block.children) ? (block.children as NotionObject[]) : [];
  const warnings: RestoreWarning[] = [];

  if (type === "child_page") {
    if (!oldBlockId) {
      return skipBlock("child_page_id_missing", "子页面区块缺少页面 ID，已跳过", oldBlockId);
    }
    const title = plainTextTitle(payload.title) || "子页面";
    return {
      action: "restore_child_page",
      childPageId: oldBlockId,
      title,
      warnings
    };
  }

  if (!type || !payload) {
    return skipBlock("unsupported_block", "无法识别区块类型，已跳过", oldBlockId);
  }

  switch (type) {
    case "paragraph":
    case "bulleted_list_item":
    case "numbered_list_item":
    case "quote":
    case "toggle":
    case "template":
      return appendBlock(type, richTextPayload(payload, warnings), childBlocks, warnings);
    case "heading_1":
    case "heading_2":
    case "heading_3":
    case "heading_4":
      return appendBlock(type, headingPayload(payload, warnings), childBlocks, warnings);
    case "to_do":
      return appendBlock(
        type,
        {
          ...richTextPayload(payload, warnings),
          checked: typeof payload.checked === "boolean" ? payload.checked : false
        },
        childBlocks,
        warnings
      );
    case "callout":
      const icon = sanitizeIcon(payload.icon, warnings);
      return appendBlock(
        type,
        {
          ...richTextPayload(payload, warnings),
          ...(icon ? { icon } : {})
        },
        childBlocks,
        warnings
      );
    case "code":
      return appendBlock(
        type,
        {
          rich_text: sanitizeRichTextArray(payload.rich_text, warnings),
          caption: sanitizeRichTextArray(payload.caption, warnings),
          language: typeof payload.language === "string" ? payload.language : "plain text"
        },
        childBlocks,
        warnings
      );
    case "divider":
      return appendBlock(type, {}, childBlocks, warnings);
    case "equation":
      return appendBlock(type, { expression: typeof payload.expression === "string" ? payload.expression : "" }, childBlocks, warnings);
    case "bookmark":
    case "embed":
      if (typeof payload.url !== "string" || !payload.url) {
        return skipBlock("missing_url", `${type} 区块缺少 URL，已跳过`, oldBlockId);
      }
      return appendBlock(type, { url: payload.url, caption: sanitizeRichTextArray(payload.caption, warnings) }, childBlocks, warnings);
    case "image":
    case "video":
    case "file":
    case "pdf":
    case "audio": {
      const media = sanitizeMediaPayload(payload, warnings, options.fileResolver);
      if (!media) {
        return warnings.length > 0
          ? {
              action: "skip",
              warnings
            }
          : skipBlock("local_file_upload_not_implemented", `${type} 区块需要本地文件上传，当前版本已跳过`, oldBlockId);
      }
      return appendBlock(type, media, childBlocks, warnings);
    }
    case "table_of_contents":
      return appendBlock(type, { color: typeof payload.color === "string" ? payload.color : "default" }, childBlocks, warnings);
    case "table":
      const tableRows = tableRowRequests(childBlocks, warnings);
      if (tableRows.length === 0) {
        return skipBlock("table_rows_missing", "table 区块缺少可恢复的行，已跳过", oldBlockId);
      }
      return appendBlock(
        type,
        {
          table_width: inferTableWidth(payload, childBlocks),
          has_column_header: Boolean(payload.has_column_header),
          has_row_header: Boolean(payload.has_row_header),
          children: tableRows
        },
        [],
        warnings
      );
    case "table_row":
      return appendBlock(
        type,
        {
          cells: Array.isArray(payload.cells) ? payload.cells.map((cell) => sanitizeRichTextArray(cell, warnings)) : []
        },
        childBlocks,
        warnings
      );
    default:
      return skipBlock("unsupported_block_type", `暂不支持恢复 ${type} 区块，已跳过`, oldBlockId);
  }
}

function createInitialReport(restoreId: string, sourceRunId: string, sourceRunKey: string, targetParentId: string): RestoreReport {
  return {
    restoreId,
    sourceRunId,
    sourceRunKey,
    targetParentId,
    status: "running",
    startedAt: nowIso(),
    finishedAt: null,
    summary: {
      createdPages: 0,
      createdDataSources: 0,
      createdBlocks: 0,
      skippedItems: 0,
      failedItems: 0,
      warningCount: 0
    },
    mappings: {
      pages: {},
      blocks: {},
      dataSources: {},
      files: {}
    },
    items: [],
    warnings: [],
    errors: [],
    manifestPath: null
  };
}

async function createPageBody(context: RestoreContext, parent: RestoreParent, artifact: PageArtifact, title: string, oldPageId: string): Promise<NotionObject> {
  const report = context.report;
  const sourcePage = artifact.page;
  const iconWarnings: RestoreWarning[] = [];
  const coverWarnings: RestoreWarning[] = [];
  const icon = sanitizeIcon(sourcePage.icon, iconWarnings);
  const cover = sanitizePageCover(sourcePage.cover, coverWarnings);
  if (sourcePage.icon && !icon) {
    addWarning(report, {
      code: "page_icon_skipped",
      message: "页面图标不是可直接恢复的 emoji/icon/custom_emoji/external 格式，已跳过",
      objectId: oldPageId
    });
  }
  if (sourcePage.cover && !cover) {
    addWarning(report, {
      code: "page_cover_skipped",
      message: "页面封面不是可直接恢复的 external 格式，已跳过",
      objectId: oldPageId
    });
  }
  const properties =
    parent.type === "data_source_id"
      ? convertPagePropertiesForRestore({
          sourceProperties: sourcePage.properties,
          propertyItems: artifact.propertyItems,
          fallbackTitle: title,
          pageId: oldPageId,
          allowedPropertyNames: parent.allowedPropertyNames,
          pageMappings: report.mappings.pages,
          fileResolver: await prepareFileUploadResolver(context, oldPageId, collectPagePropertyFileObjects(sourcePage.properties, parent.allowedPropertyNames))
        })
      : {
          properties: {
            title: {
              title: textRichText(title)
            }
          },
          warnings: []
        };
  for (const warning of properties.warnings) {
    addWarning(report, warning);
  }
  return {
    parent:
      parent.type === "page_id"
        ? {
            type: "page_id",
            page_id: parent.page_id
          }
        : {
            type: "data_source_id",
            data_source_id: parent.data_source_id
          },
    properties: properties.properties,
    ...(icon ? { icon } : {}),
    ...(cover ? { cover } : {})
  };
}

async function validateRestoreTarget(notion: NotionClient, targetParentId: string): Promise<void> {
  try {
    await notion.retrievePage(targetParentId);
  } catch (error) {
    if (error instanceof NotionApiError && [401, 403, 404].includes(error.status)) {
      throw badRequest("目标父页面不可访问，请确认页面已分享给当前 Notion 集成");
    }
    throw error;
  }
}

function assertRestoreNotCanceled(context: RestoreContext): void {
  if (context.shouldCancel?.()) {
    throw new RestoreCanceledError();
  }
}

async function emitProgress(context: RestoreContext): Promise<void> {
  context.report.summary.failedItems = context.report.items.filter((item) => item.status === "failed").length;
  context.report.summary.skippedItems = context.report.items.filter((item) => item.status === "skipped").length;
  context.report.summary.warningCount = context.report.warnings.length;
  await context.onProgress?.(context.report);
}

function finishReport(report: RestoreReport, statusOverride?: RestoreStatus): void {
  const failedItems = report.items.filter((item) => item.status === "failed").length;
  const skippedItems = report.items.filter((item) => item.status === "skipped").length;
  report.summary.failedItems = failedItems;
  report.summary.skippedItems = skippedItems;
  report.summary.warningCount = report.warnings.length;
  report.finishedAt = nowIso();
  report.status =
    statusOverride ??
    resolveRestoreStatus({
      createdPages: report.summary.createdPages,
      createdDataSources: report.summary.createdDataSources,
      failedItems,
      skippedItems,
      errorCount: report.errors.length
    });
}

async function persistRestoreReport(runDir: string, report: RestoreReport): Promise<void> {
  const manifestPath = path.join(runDir, "restores", report.restoreId, "restore-manifest.json");
  report.manifestPath = path.relative(runDir, manifestPath);
  await writeJson(manifestPath, report);
  await writeJson(path.join(runDir, RESTORE_LATEST_FILE), report);
}

async function readPageArtifact(runDir: string, pageId: string): Promise<PageArtifact> {
  const filePath = pageArtifactPath(runDir, pageId);
  if (!existsSync(filePath)) {
    throw notFound(`页面备份文件不存在：${pageId}`);
  }
  const artifact = await readJson<PageArtifact>(filePath);
  if (!artifact.page || !Array.isArray(artifact.blocks)) {
    throw badRequest(`页面备份文件格式无效：${pageId}`);
  }
  return artifact;
}

async function readDataSourceSchema(runDir: string, dataSourceId: string): Promise<NotionObject> {
  const filePath = path.join(dataSourceArtifactPath(runDir, dataSourceId), "schema.json");
  if (!existsSync(filePath)) {
    throw notFound(`数据源 schema 备份文件不存在：${dataSourceId}`);
  }
  const schema = await readJson<NotionObject>(filePath);
  if (!schema || typeof schema !== "object") {
    throw badRequest(`数据源 schema 备份文件格式无效：${dataSourceId}`);
  }
  return schema;
}

async function readDataSourceEntries(runDir: string, dataSourceId: string): Promise<NotionObject[]> {
  const filePath = path.join(dataSourceArtifactPath(runDir, dataSourceId), "entries.json");
  if (!existsSync(filePath)) {
    throw notFound(`数据源 entries 备份文件不存在：${dataSourceId}`);
  }
  const entries = await readJson<unknown>(filePath);
  if (!Array.isArray(entries)) {
    throw badRequest(`数据源 entries 备份文件格式无效：${dataSourceId}`);
  }
  return entries.filter((entry): entry is NotionObject => Boolean(entry && typeof entry === "object"));
}

async function prepareFileUploadResolver(context: RestoreContext, pageId: string, fileObjects: NotionObject[]): Promise<FileUploadResolver | undefined> {
  const uploadResults = new Map<string, { payload?: RestoredFilePayload; warning?: RestoreWarning }>();
  for (const fileObject of fileObjects) {
    const fileUrl = fileUrlFromObject(fileObject);
    if (!fileUrl || uploadResults.has(fileUrl)) {
      continue;
    }
    uploadResults.set(fileUrl, await fileUploadPayloadForAsset(context, pageId, fileUrl, fileNameFromObject(fileObject)));
  }
  if (uploadResults.size === 0) {
    return undefined;
  }
  return (fileObject, warnings) => {
    const fileUrl = fileUrlFromObject(fileObject);
    const result = fileUrl ? uploadResults.get(fileUrl) : undefined;
    if (result?.payload) {
      return result.payload;
    }
    warnings.push(
      result?.warning ?? {
        code: "file_upload_source_missing",
        message: "文件缺少可恢复的原始 URL，已跳过"
      }
    );
    return null;
  };
}

async function fileUploadPayloadForAsset(context: RestoreContext, pageId: string, fileUrl: string, fallbackName: string): Promise<{ payload?: RestoredFilePayload; warning?: RestoreWarning }> {
  const cached = context.uploadedFiles.get(fileUrl);
  if (cached) {
    return { payload: cached };
  }
  const manifest = await loadAssetManifest(context, pageId);
  if (!manifest) {
    return {
      warning: {
        code: "asset_manifest_missing",
        message: "本地资产 manifest 不存在，无法上传恢复文件",
        objectId: pageId,
        details: { fileUrl }
      }
    };
  }
  const result = manifest.find((item) => item.candidate.url === fileUrl);
  if (!result) {
    return {
      warning: {
        code: "asset_not_downloaded",
        message: "备份中没有找到对应的本地文件资产，已跳过文件恢复",
        objectId: pageId,
        details: { fileUrl }
      }
    };
  }
  if (result.status === "skipped") {
    return {
      warning: {
        code: "asset_download_skipped",
        message: `文件备份时未下载，已跳过文件恢复：${result.reason}`,
        objectId: pageId,
        details: { fileUrl }
      }
    };
  }

  const localPath = resolveDownloadedAssetPath(context.runDir, pageId, result.path);
  if (!localPath) {
    return {
      warning: {
        code: "asset_file_missing",
        message: "本地资产文件不存在，已跳过文件恢复",
        objectId: pageId,
        details: { fileUrl, path: result.path }
      }
    };
  }
  let fileInfo: Awaited<ReturnType<typeof stat>>;
  try {
    fileInfo = await stat(localPath);
  } catch {
    return {
      warning: {
        code: "asset_file_missing",
        message: "本地资产文件不存在，已跳过文件恢复",
        objectId: pageId,
        details: { fileUrl, path: result.path }
      }
    };
  }
  if (fileInfo.size > SINGLE_PART_FILE_UPLOAD_LIMIT_BYTES) {
    return {
      warning: {
        code: "file_upload_multipart_required",
        message: "文件超过 20 MiB，需要 multipart 上传，当前版本已跳过",
        objectId: pageId,
        details: { fileUrl, path: result.path, bytes: fileInfo.size }
      }
    };
  }

  assertRestoreNotCanceled(context);
  const filename = safeUploadFileName(fallbackName || result.candidate.name || path.basename(localPath));
  const contentType = inferContentType(filename);
  try {
    const upload = await context.notion.createSinglePartFileUpload({
      filename,
      contentType
    });
    const uploadId = String(upload.id ?? "");
    if (!uploadId) {
      return {
        warning: {
          code: "file_upload_failed",
          message: "Notion 未返回文件上传 ID，已跳过文件恢复",
          objectId: pageId,
          details: { fileUrl }
        }
      };
    }
    assertRestoreNotCanceled(context);
    const bytes = await readFile(localPath);
    const sent = await context.notion.sendFileUpload({
      fileUploadId: uploadId,
      filename,
      data: new Blob([new Uint8Array(bytes)], { type: contentType })
    });
    if (sent.status !== "uploaded") {
      return {
        warning: {
          code: "file_upload_failed",
          message: `Notion 文件上传未完成，状态：${sent.status}`,
          objectId: pageId,
          details: { fileUrl, fileUploadId: uploadId }
        }
      };
    }
    const payload: RestoredFilePayload = {
      type: "file_upload",
      file_upload: {
        id: uploadId
      }
    };
    context.uploadedFiles.set(fileUrl, payload);
    context.report.mappings.files[fileUrl] = uploadId;
    return { payload };
  } catch (error) {
    if (error instanceof RestoreCanceledError) {
      throw error;
    }
    return {
      warning: {
        code: "file_upload_failed",
        message: `文件上传到 Notion 失败，已跳过文件恢复：${errorMessage(error)}`,
        objectId: pageId,
        details: { fileUrl }
      }
    };
  }
}

async function loadAssetManifest(context: RestoreContext, pageId: string): Promise<DownloadResult[] | null> {
  if (context.assetManifests.has(pageId)) {
    return context.assetManifests.get(pageId) ?? null;
  }
  const manifestPath = path.join(context.runDir, "assets", pageId, "manifest.json");
  if (!existsSync(manifestPath)) {
    context.assetManifests.set(pageId, null);
    return null;
  }
  const manifest = await readJson<unknown>(manifestPath).catch(() => null);
  if (!Array.isArray(manifest)) {
    context.assetManifests.set(pageId, null);
    return null;
  }
  const results = manifest.filter(isDownloadResult);
  context.assetManifests.set(pageId, results);
  return results;
}

async function readJson<T>(filePath: string): Promise<T> {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text) as T;
}

function pageArtifactPath(runDir: string, pageId: string): string {
  return path.join(runDir, "pages", `${pageId}.json`);
}

function dataSourceArtifactPath(runDir: string, dataSourceId: string): string {
  return path.join(runDir, "data-sources", dataSourceId);
}

function isDownloadResult(value: unknown): value is DownloadResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const candidate = record.candidate;
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  const candidateRecord = candidate as Record<string, unknown>;
  if (typeof candidateRecord.url !== "string" || typeof candidateRecord.name !== "string") {
    return false;
  }
  if (record.status === "downloaded") {
    return typeof record.path === "string" && typeof record.bytes === "number";
  }
  return record.status === "skipped" && typeof record.reason === "string";
}

function resolveDownloadedAssetPath(runDir: string, pageId: string, storedPath: string): string | null {
  if (existsSync(storedPath)) {
    return storedPath;
  }
  const fallback = path.join(runDir, "assets", pageId, path.basename(storedPath));
  return existsSync(fallback) ? fallback : null;
}

function collectPagePropertyFileObjects(sourceProperties: unknown, allowedPropertyNames?: Set<string>): NotionObject[] {
  if (!sourceProperties || typeof sourceProperties !== "object") {
    return [];
  }
  const files: NotionObject[] = [];
  for (const [propertyName, rawProperty] of Object.entries(sourceProperties as Record<string, unknown>)) {
    if (!rawProperty || typeof rawProperty !== "object") {
      continue;
    }
    if (allowedPropertyNames && !allowedPropertyNames.has(propertyName)) {
      continue;
    }
    const property = rawProperty as NotionObject;
    if (property.type !== "files" || !Array.isArray(property.files)) {
      continue;
    }
    for (const file of property.files) {
      if (file && typeof file === "object") {
        files.push(file as NotionObject);
      }
    }
  }
  return files;
}

function mediaPayloadNeedsUpload(type: string, payload: NotionObject): boolean {
  return ["image", "video", "file", "pdf", "audio"].includes(type) && payload.type === "file" && typeof getPayload(payload, "file").url === "string";
}

function fileUrlFromObject(fileObject: NotionObject): string | null {
  if (fileObject.type !== "file") {
    return null;
  }
  const file = getPayload(fileObject, "file");
  return typeof file.url === "string" && file.url ? file.url : null;
}

function fileNameFromObject(fileObject: NotionObject): string {
  if (typeof fileObject.name === "string" && fileObject.name) {
    return fileObject.name;
  }
  const fileUrl = fileUrlFromObject(fileObject);
  if (!fileUrl) {
    return "file";
  }
  try {
    const parsed = new URL(fileUrl);
    return parsed.pathname.split("/").filter(Boolean).at(-1) || "file";
  } catch {
    return "file";
  }
}

export function safeUploadFileName(value: string): string {
  const sanitized = Array.from(value.normalize("NFC").replace(/[\p{C}<>:"/\\|?*]/gu, "_").trim())
    .slice(0, 180)
    .join("");
  return sanitized && sanitized !== "." && sanitized !== ".." ? sanitized : "file";
}

function inferContentType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  switch (extension) {
    case ".avif":
      return "image/avif";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".wav":
      return "audio/wav";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".pdf":
      return "application/pdf";
    case ".csv":
      return "text/csv";
    case ".json":
      return "application/json";
    case ".md":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function extractCreatedDataSourceId(response: NotionObject): string | null {
  if (response.object === "data_source" && typeof response.id === "string") {
    return response.id;
  }
  if (Array.isArray(response.data_sources)) {
    for (const dataSource of response.data_sources) {
      if (dataSource && typeof dataSource === "object" && typeof (dataSource as { id?: unknown }).id === "string") {
        return (dataSource as { id: string }).id;
      }
    }
  }
  const initialDataSource = response.initial_data_source;
  if (initialDataSource && typeof initialDataSource === "object" && typeof (initialDataSource as { id?: unknown }).id === "string") {
    return (initialDataSource as { id: string }).id;
  }
  return null;
}

function addSkippedItem(report: RestoreReport, item: BackupRunItem, message: string): { warnings: RestoreWarning[] } {
  const warning: RestoreWarning = {
    code: "restore_item_skipped",
    message,
    objectId: item.objectId
  };
  addWarning(report, warning);
  report.items.push({
    objectId: item.objectId,
    objectType: item.objectType as NotionObjectType,
    title: item.title,
    status: "skipped",
    warnings: [warning]
  });
  return { warnings: [warning] };
}

function addWarning(report: RestoreReport, warning: RestoreWarning): void {
  report.warnings.push(warning);
}

function appendBlock(type: string, payload: NotionObject, childBlocks: NotionObject[], warnings: RestoreWarning[]): BlockConversion {
  return {
    action: "append",
    request: {
      type,
      [type]: payload
    },
    childBlocks,
    warnings
  };
}

function skipBlock(code: string, message: string, blockId?: string): BlockConversion {
  return {
    action: "skip",
    warnings: [
      {
        code,
        message,
        blockId
      }
    ]
  };
}

function getPayload(block: NotionObject, type: string): NotionObject {
  const payload = block[type];
  return payload && typeof payload === "object" ? (payload as NotionObject) : {};
}

export function resolveRestoreStatus(input: { createdPages: number; createdDataSources?: number; failedItems: number; skippedItems: number; errorCount: number }): RestoreStatus {
  if (input.failedItems > 0 || input.skippedItems > 0 || input.errorCount > 0) {
    return input.createdPages + (input.createdDataSources ?? 0) > 0 ? "partial_failed" : "failed";
  }
  return "succeeded";
}

export function collectPageArtifactRestoreWarnings(artifact: { page: NotionObject; comments?: unknown }, pageId: string): RestoreWarning[] {
  const warnings: RestoreWarning[] = [];
  const properties = artifact.page.properties;
  if (properties && typeof properties === "object") {
    for (const [propertyName, rawProperty] of Object.entries(properties as Record<string, unknown>)) {
      if (!rawProperty || typeof rawProperty !== "object") {
        continue;
      }
      const property = rawProperty as NotionObject;
      const propertyType = typeof property.type === "string" ? property.type : "unknown";
      if (propertyType === "title") {
        continue;
      }
      if (propertyType === "relation") {
        warnings.push({
          code: "relation_property_skipped",
          message: `关系属性当前版本不会恢复，已跳过：${propertyName}`,
          objectId: pageId,
          details: {
            propertyName,
            propertyType
          }
        });
        continue;
      }
      warnings.push({
        code: READ_ONLY_PAGE_PROPERTY_TYPES.has(propertyType) ? "read_only_property_skipped" : "page_property_skipped",
        message: `页面属性当前版本不会写入目标父页面，已跳过：${propertyName}`,
        objectId: pageId,
        details: {
          propertyName,
          propertyType
        }
      });
    }
  }

  if (hasBackedUpComments(artifact.comments)) {
    warnings.push({
      code: "comments_restore_not_implemented",
      message: "评论恢复尚未实现；当前版本不会重新创建评论",
      objectId: pageId
    });
  }
  return warnings;
}

function collectPageCommentsRestoreWarnings(artifact: { comments?: unknown }, pageId: string): RestoreWarning[] {
  if (!hasBackedUpComments(artifact.comments)) {
    return [];
  }
  return [
    {
      code: "comments_restore_not_implemented",
      message: "评论恢复尚未实现；当前版本不会重新创建评论",
      objectId: pageId
    }
  ];
}

export function convertDataSourcePropertiesForRestore(sourceProperties: unknown, dataSourceId = ""): { properties: Record<string, NotionObject>; warnings: RestoreWarning[] } {
  const warnings: RestoreWarning[] = [];
  const properties: Record<string, NotionObject> = {};
  let hasTitle = false;
  if (sourceProperties && typeof sourceProperties === "object") {
    for (const [propertyName, rawProperty] of Object.entries(sourceProperties as Record<string, unknown>)) {
      if (!rawProperty || typeof rawProperty !== "object") {
        continue;
      }
      const property = rawProperty as NotionObject;
      const propertyType = typeof property.type === "string" ? property.type : "";
      const converted = convertDataSourcePropertySchema(propertyName, property, propertyType, dataSourceId, warnings);
      if (!converted) {
        continue;
      }
      if (propertyType === "title") {
        hasTitle = true;
      }
      properties[propertyName] = converted;
    }
  }
  if (!hasTitle) {
    properties.Name = {
      title: {}
    };
    warnings.push({
      code: "data_source_title_schema_added",
      message: "数据源 schema 缺少标题属性，已添加默认 Name 标题属性",
      objectId: dataSourceId || undefined
    });
  }
  return {
    properties,
    warnings
  };
}

export function convertPagePropertiesForRestore(input: {
  sourceProperties: unknown;
  propertyItems?: Record<string, unknown>;
  fallbackTitle: string;
  pageId?: string;
  allowedPropertyNames?: Set<string>;
  pageMappings?: Record<string, string>;
  fileResolver?: FileUploadResolver;
}): { properties: Record<string, NotionObject>; warnings: RestoreWarning[] } {
  const warnings: RestoreWarning[] = [];
  const properties: Record<string, NotionObject> = {};
  let titlePropertyName: string | null = null;
  if (input.sourceProperties && typeof input.sourceProperties === "object") {
    for (const [propertyName, rawProperty] of Object.entries(input.sourceProperties as Record<string, unknown>)) {
      if (!rawProperty || typeof rawProperty !== "object") {
        continue;
      }
      const property = rawProperty as NotionObject;
      const propertyType = typeof property.type === "string" ? property.type : "";
      if (propertyType === "title") {
        titlePropertyName = propertyName;
      }
      if (input.allowedPropertyNames && !input.allowedPropertyNames.has(propertyName)) {
        warnings.push(propertyWarning("page_property_schema_missing", `目标数据源缺少可写属性，已跳过：${propertyName}`, input.pageId, propertyName, propertyType));
        continue;
      }
      const converted = convertPagePropertyValue({
        propertyName,
        property,
        propertyItem: input.propertyItems?.[propertyName],
        propertyType,
        fallbackTitle: input.fallbackTitle,
        pageId: input.pageId,
        pageMappings: input.pageMappings,
        fileResolver: input.fileResolver,
        warnings
      });
      if (converted) {
        properties[propertyName] = converted;
      }
    }
  }
  if (!Object.values(properties).some((property) => "title" in property)) {
    const name = titlePropertyName || "Name";
    if (!input.allowedPropertyNames || input.allowedPropertyNames.has(name)) {
      properties[name] = {
        title: textRichText(input.fallbackTitle)
      };
    }
  }
  return {
    properties,
    warnings
  };
}

function convertDataSourcePropertySchema(
  propertyName: string,
  property: NotionObject,
  propertyType: string,
  dataSourceId: string,
  warnings: RestoreWarning[]
): NotionObject | null {
  if (!propertyType || UNSUPPORTED_SCHEMA_PROPERTY_TYPES.has(propertyType)) {
    warnings.push(
      propertyWarning(
        propertyType === "relation" ? "relation_schema_skipped" : "data_source_schema_property_skipped",
        `数据源属性 schema 当前版本不会恢复，已跳过：${propertyName}`,
        dataSourceId,
        propertyName,
        propertyType || "unknown"
      )
    );
    return null;
  }
  const payload = getPayload(property, propertyType);
  switch (propertyType) {
    case "title":
      return { title: {} };
    case "rich_text":
      return { rich_text: {} };
    case "number":
      return { number: typeof payload.format === "string" ? { format: payload.format } : {} };
    case "select":
      return { select: { options: sanitizeSelectOptions(payload.options) } };
    case "multi_select":
      return { multi_select: { options: sanitizeSelectOptions(payload.options) } };
    case "status":
      return { status: { options: sanitizeSelectOptions(payload.options) } };
    case "date":
      return { date: {} };
    case "checkbox":
      return { checkbox: {} };
    case "url":
      return { url: {} };
    case "email":
      return { email: {} };
    case "phone_number":
      return { phone_number: {} };
    case "files":
      return { files: {} };
    case "people":
      return { people: {} };
    case "unique_id":
      return { unique_id: { prefix: typeof payload.prefix === "string" ? payload.prefix : null } };
    case "created_by":
      return { created_by: {} };
    case "created_time":
      return { created_time: {} };
    case "last_edited_by":
      return { last_edited_by: {} };
    case "last_edited_time":
      return { last_edited_time: {} };
    case "place":
      return { place: {} };
    default:
      warnings.push(propertyWarning("data_source_schema_property_skipped", `暂不支持恢复 ${propertyType} 数据源属性 schema，已跳过：${propertyName}`, dataSourceId, propertyName, propertyType));
      return null;
  }
}

function convertPagePropertyValue(input: {
  propertyName: string;
  property: NotionObject;
  propertyItem?: unknown;
  propertyType: string;
  fallbackTitle: string;
  pageId?: string;
  pageMappings?: Record<string, string>;
  fileResolver?: FileUploadResolver;
  warnings: RestoreWarning[];
}): NotionObject | null {
  const value = propertyValueObject(input.property, input.propertyItem, input.propertyType);
  switch (input.propertyType) {
    case "title": {
      const title = sanitizeRichTextArray(richTextItemsForProperty(input.property, input.propertyItem, "title"), input.warnings);
      return {
        title: title.length > 0 ? title : textRichText(input.fallbackTitle)
      };
    }
    case "rich_text":
      return {
        rich_text: sanitizeRichTextArray(richTextItemsForProperty(input.property, input.propertyItem, "rich_text"), input.warnings)
      };
    case "number":
      return { number: typeof value.number === "number" ? value.number : value.number === null ? null : null };
    case "checkbox":
      return { checkbox: value.checkbox === true };
    case "select":
      return { select: sanitizeSelectValue(value.select) };
    case "multi_select":
      return { multi_select: Array.isArray(value.multi_select) ? value.multi_select.flatMap((option) => sanitizeSelectValue(option) ?? []) : [] };
    case "status":
      return { status: sanitizeSelectValue(value.status) };
    case "date":
      return { date: sanitizeDateValue(value.date) };
    case "url":
      return { url: typeof value.url === "string" ? value.url : value.url === null ? null : null };
    case "email":
      return { email: typeof value.email === "string" ? value.email : value.email === null ? null : null };
    case "phone_number":
      return { phone_number: typeof value.phone_number === "string" ? value.phone_number : value.phone_number === null ? null : null };
    case "files": {
      const files = sanitizeFilePropertyValue(value.files, input);
      return files ? { files } : null;
    }
    case "place":
      return { place: sanitizePlaceValue(value.place) };
    case "relation": {
      const relation = relationValueForRestore(input.property, input.propertyItem, input.pageMappings, input);
      return relation ? { relation } : null;
    }
    case "people":
      input.warnings.push(propertyWarning("people_property_skipped", `人员属性当前版本不会恢复，已跳过：${input.propertyName}`, input.pageId, input.propertyName, input.propertyType));
      return null;
    default:
      input.warnings.push(
        propertyWarning(
          READ_ONLY_PAGE_PROPERTY_TYPES.has(input.propertyType) ? "read_only_property_skipped" : "page_property_skipped",
          `页面属性当前版本不会恢复，已跳过：${input.propertyName}`,
          input.pageId,
          input.propertyName,
          input.propertyType || "unknown"
        )
      );
      return null;
  }
}

function propertyValueObject(property: NotionObject, propertyItem: unknown, propertyType: string): NotionObject {
  if (propertyItem && typeof propertyItem === "object") {
    const item = propertyItem as NotionObject;
    if (item.object === "property_item" && item.type === propertyType) {
      return item;
    }
  }
  return property;
}

function richTextItemsForProperty(property: NotionObject, propertyItem: unknown, propertyType: "title" | "rich_text"): unknown[] {
  if (propertyItem && typeof propertyItem === "object") {
    const item = propertyItem as NotionObject;
    if (item.object === "list" && Array.isArray(item.results)) {
      return item.results.flatMap((result) => {
        if (!result || typeof result !== "object") {
          return [];
        }
        const payload = (result as NotionObject)[propertyType];
        return payload && typeof payload === "object" ? [payload] : [];
      });
    }
    if (item.object === "property_item" && item.type === propertyType) {
      const payload = item[propertyType];
      return payload && typeof payload === "object" ? [payload] : [];
    }
  }
  const payload = property[propertyType];
  return Array.isArray(payload) ? payload : [];
}

function relationValueForRestore(
  property: NotionObject,
  propertyItem: unknown,
  pageMappings: Record<string, string> | undefined,
  input: { propertyName: string; propertyType: string; pageId?: string; warnings: RestoreWarning[] }
): NotionObject[] | null {
  const ids = relationIdsForProperty(property, propertyItem);
  if (ids.length === 0) {
    return [];
  }
  const restoredIds = ids.flatMap((id) => {
    const restoredId = pageMappings?.[id];
    return restoredId ? [{ id: restoredId }] : [];
  });
  if (restoredIds.length !== ids.length) {
    input.warnings.push(
      propertyWarning("relation_property_unresolved", `关系属性包含未在本次恢复中映射的页面，已跳过未映射关系：${input.propertyName}`, input.pageId, input.propertyName, input.propertyType)
    );
  }
  return restoredIds.length > 0 ? restoredIds : null;
}

function relationIdsForProperty(property: NotionObject, propertyItem: unknown): string[] {
  if (propertyItem && typeof propertyItem === "object") {
    const item = propertyItem as NotionObject;
    if (item.object === "list" && Array.isArray(item.results)) {
      return item.results.flatMap((result) => {
        if (!result || typeof result !== "object") {
          return [];
        }
        const relation = getPayload(result as NotionObject, "relation");
        return typeof relation.id === "string" ? [relation.id] : [];
      });
    }
  }
  const relation = property.relation;
  if (!Array.isArray(relation)) {
    return [];
  }
  return relation.flatMap((item) => (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" ? [(item as { id: string }).id] : []));
}

function sanitizeSelectOptions(value: unknown): NotionObject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((option) => {
    const sanitized = sanitizeSelectValue(option);
    return sanitized ? [sanitized] : [];
  });
}

function sanitizeSelectValue(value: unknown): NotionObject | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const option = value as NotionObject;
  if (typeof option.name !== "string" || !option.name) {
    return null;
  }
  return {
    name: option.name,
    ...(typeof option.color === "string" ? { color: option.color } : {}),
    ...(typeof option.description === "string" || option.description === null ? { description: option.description } : {})
  };
}

function sanitizeDateValue(value: unknown): NotionObject | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const date = value as NotionObject;
  if (typeof date.start !== "string" || !date.start) {
    return null;
  }
  return {
    start: date.start,
    ...(typeof date.end === "string" || date.end === null ? { end: date.end } : {}),
    ...(typeof date.time_zone === "string" || date.time_zone === null ? { time_zone: date.time_zone } : {})
  };
}

function sanitizeFilePropertyValue(
  value: unknown,
  input: { propertyName: string; propertyType: string; pageId?: string; fileResolver?: FileUploadResolver; warnings: RestoreWarning[] }
): NotionObject[] | null {
  if (!Array.isArray(value)) {
    return [];
  }
  const files: NotionObject[] = [];
  for (const file of value) {
    if (!file || typeof file !== "object") {
      continue;
    }
    const record = file as NotionObject;
    if (record.type === "external") {
      const external = getPayload(record, "external");
      if (typeof external.url === "string" && external.url) {
        files.push({
          type: "external",
          name: typeof record.name === "string" && record.name ? record.name : "file",
          external: {
            url: external.url
          }
        });
      }
      continue;
    }
    const warningCount = input.warnings.length;
    const uploaded = input.fileResolver?.(record, input.warnings);
    if (uploaded) {
      files.push({
        ...uploaded,
        name: typeof record.name === "string" && record.name ? record.name : "file"
      });
      continue;
    }
    if (input.warnings.length === warningCount) {
      input.warnings.push(
        propertyWarning("file_property_upload_not_implemented", `文件属性包含 Notion 托管或本地文件，当前版本已跳过：${input.propertyName}`, input.pageId, input.propertyName, input.propertyType)
      );
    }
  }
  return files.length > 0 || value.length === 0 ? files : null;
}

function sanitizePlaceValue(value: unknown): NotionObject | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const place = value as NotionObject;
  if (typeof place.lat !== "number" || typeof place.lon !== "number") {
    return null;
  }
  return {
    lat: place.lat,
    lon: place.lon,
    ...(typeof place.name === "string" || place.name === null ? { name: place.name } : {}),
    ...(typeof place.address === "string" || place.address === null ? { address: place.address } : {}),
    ...(typeof place.aws_place_id === "string" || place.aws_place_id === null ? { aws_place_id: place.aws_place_id } : {}),
    ...(typeof place.google_place_id === "string" || place.google_place_id === null ? { google_place_id: place.google_place_id } : {})
  };
}

function propertyWarning(code: string, message: string, objectId: string | undefined, propertyName: string, propertyType: string): RestoreWarning {
  return {
    code,
    message,
    objectId,
    details: {
      propertyName,
      propertyType
    }
  };
}

function richTextPayload(payload: NotionObject, warnings: RestoreWarning[]): NotionObject {
  return {
    rich_text: sanitizeRichTextArray(payload.rich_text, warnings),
    color: typeof payload.color === "string" ? payload.color : "default"
  };
}

function headingPayload(payload: NotionObject, warnings: RestoreWarning[]): NotionObject {
  return {
    ...richTextPayload(payload, warnings),
    ...(typeof payload.is_toggleable === "boolean" ? { is_toggleable: payload.is_toggleable } : {})
  };
}

function inferTableWidth(payload: NotionObject, childBlocks: NotionObject[]): number {
  if (typeof payload.table_width === "number" && payload.table_width > 0) {
    return payload.table_width;
  }
  const rowWidths = childBlocks
    .map((block) => {
      if (block.type !== "table_row") {
        return 0;
      }
      const row = getPayload(block, "table_row");
      return Array.isArray(row.cells) ? row.cells.length : 0;
    })
    .filter((width) => width > 0);
  return Math.max(1, ...rowWidths);
}

function tableRowRequests(childBlocks: NotionObject[], warnings: RestoreWarning[]): NotionObject[] {
  return childBlocks
    .filter((block) => block.type === "table_row")
    .map((block) => {
      const row = getPayload(block, "table_row");
      return {
        type: "table_row",
        table_row: {
          cells: Array.isArray(row.cells) ? row.cells.map((cell) => sanitizeRichTextArray(cell, warnings)) : []
        }
      };
    });
}

function sanitizeRichTextArray(value: unknown, warnings: RestoreWarning[]): NotionObject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((part): NotionObject[] => {
    if (!part || typeof part !== "object") {
      return [];
    }
    const record = part as NotionObject;
    const annotations = record.annotations && typeof record.annotations === "object" ? { annotations: record.annotations } : {};
    if (record.type === "text") {
      const text = getPayload(record, "text");
      return [
        {
          type: "text",
          text: {
            content: typeof text.content === "string" ? text.content : String(record.plain_text ?? ""),
            ...(text.link && typeof text.link === "object" ? { link: text.link } : {})
          },
          ...annotations
        }
      ];
    }
    if (record.type === "equation") {
      const equation = getPayload(record, "equation");
      return [
        {
          type: "equation",
          equation: {
            expression: typeof equation.expression === "string" ? equation.expression : ""
          },
          ...annotations
        }
      ];
    }
    const text = String(record.plain_text ?? "").trim();
    if (text) {
      warnings.push({
        code: "rich_text_mention_downgraded",
        message: "富文本 mention 或暂不支持类型已降级为普通文本"
      });
      return [
        {
          type: "text",
          text: {
            content: text
          },
          ...annotations
        }
      ];
    }
    return [];
  });
}

function textRichText(value: string): NotionObject[] {
  return [
    {
      type: "text",
      text: {
        content: value || "恢复页面"
      }
    }
  ];
}

function sanitizeMediaPayload(payload: NotionObject, warnings: RestoreWarning[], fileResolver?: FileUploadResolver): NotionObject | null {
  const caption = sanitizeRichTextArray(payload.caption, warnings);
  const type = payload.type;
  if (type === "external") {
    const external = getPayload(payload, "external");
    if (typeof external.url === "string" && external.url) {
      return {
        type: "external",
        external: {
          url: external.url
        },
        caption
      };
    }
  }
  if (type === "file") {
    const uploaded = fileResolver?.(payload, warnings);
    if (uploaded) {
      return {
        ...uploaded,
        caption
      };
    }
  }
  return null;
}

function sanitizeIcon(value: unknown, warnings: RestoreWarning[]): NotionObject | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as NotionObject;
  if (record.type === "emoji" && typeof record.emoji === "string") {
    return {
      type: "emoji",
      emoji: record.emoji
    };
  }
  if (record.type === "external") {
    const external = getPayload(record, "external");
    if (typeof external.url === "string" && external.url) {
      return {
        type: "external",
        external: {
          url: external.url
        }
      };
    }
  }
  if (record.type === "icon") {
    const icon = getPayload(record, "icon");
    if (typeof icon.name === "string" && icon.name) {
      return {
        type: "icon",
        icon: {
          name: icon.name,
          ...(typeof icon.color === "string" ? { color: icon.color } : {})
        }
      };
    }
  }
  if (record.type === "custom_emoji") {
    const customEmoji = getPayload(record, "custom_emoji");
    if (typeof customEmoji.id === "string" && customEmoji.id) {
      return {
        type: "custom_emoji",
        custom_emoji: {
          id: customEmoji.id,
          ...(typeof customEmoji.name === "string" ? { name: customEmoji.name } : {}),
          ...(typeof customEmoji.url === "string" ? { url: customEmoji.url } : {})
        }
      };
    }
  }
  warnings.push({
    code: "icon_skipped",
    message: "图标不是可直接恢复的 emoji/icon/custom_emoji/external 格式，已跳过"
  });
  return null;
}

function sanitizePageCover(value: unknown, warnings: RestoreWarning[]): NotionObject | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as NotionObject;
  if (record.type === "external") {
    const external = getPayload(record, "external");
    if (typeof external.url === "string" && external.url) {
      return {
        type: "external",
        external: {
          url: external.url
        }
      };
    }
  }
  warnings.push({
    code: "cover_skipped",
    message: "封面不是可直接恢复的 external 格式，已跳过"
  });
  return null;
}

function hasBackedUpComments(value: unknown): boolean {
  if (!value) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value !== "object") {
    return true;
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.results)) {
    return record.results.length > 0;
  }
  return Object.keys(record).length > 0;
}

function plainTextTitle(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (part && typeof part === "object" && "plain_text" in part) {
          return String((part as { plain_text?: unknown }).plain_text ?? "");
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
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

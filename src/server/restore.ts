import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { BackupRunDetail, BackupRunItem, NotionObjectType, RestoreReport, RestoreStatus, RestoreWarning } from "../shared/types.js";
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

type RestoreContext = {
  notion: NotionClient;
  runDir: string;
  report: RestoreReport;
  restoringPages: Set<string>;
};

const RESTORE_LATEST_FILE = "restore-latest.json";
const RESTORE_CHILD_CHUNK_SIZE = 100;
const READ_ONLY_PAGE_PROPERTY_TYPES = new Set(["created_by", "created_time", "last_edited_by", "last_edited_time", "formula", "rollup", "unique_id", "verification"]);

export async function restoreRunToNotion(input: { runId: string; targetParentId: string; token: string }): Promise<RestoreReport> {
  const run = getRun(input.runId);
  await validateRestorePreflight(run);
  const runDir = run.artifactDir;
  if (!runDir) {
    throw notFound("备份文件不存在");
  }

  const notion = new NotionClient(input.token);
  try {
    await notion.retrievePage(input.targetParentId);
  } catch (error) {
    if (error instanceof NotionApiError && [401, 403, 404].includes(error.status)) {
      throw badRequest("目标父页面不可访问，请确认页面已分享给当前 Notion 集成");
    }
    throw error;
  }

  const restoreId = `${nowIso().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z")}_${nanoid(6)}`;
  const report = createInitialReport(restoreId, run.id, run.runKey, input.targetParentId);
  const context: RestoreContext = {
    notion,
    runDir,
    report,
    restoringPages: new Set()
  };

  for (const item of run.items) {
    if (item.status !== "succeeded") {
      addSkippedItem(report, item, "只恢复状态为成功的备份项目");
      continue;
    }
    if (item.objectType !== "page") {
      addSkippedItem(report, item, "数据源结构恢复尚未在当前版本实现");
      addWarning(report, {
        code: "data_source_restore_not_implemented",
        message: "数据源、视图和条目结构恢复尚未实现；当前版本仅恢复页面 JSON",
        objectId: item.objectId
      });
      continue;
    }

    const itemWarningsStart = report.warnings.length;
    try {
      const newPageId = await restorePageArtifact(context, item.objectId, input.targetParentId, item.title);
      const warnings = report.warnings.slice(itemWarningsStart);
      report.items.push({
        objectId: item.objectId,
        objectType: item.objectType,
        title: item.title,
        status: "succeeded",
        newPageId,
        warnings
      });
    } catch (error) {
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
    }
  }

  finishReport(report);
  await persistRestoreReport(runDir, report);
  return report;
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

async function restorePageArtifact(context: RestoreContext, pageId: string, targetParentId: string, fallbackTitle?: string): Promise<string> {
  if (context.report.mappings.pages[pageId]) {
    return context.report.mappings.pages[pageId];
  }
  if (context.restoringPages.has(pageId)) {
    addWarning(context.report, {
      code: "page_cycle_skipped",
      message: "检测到循环子页面引用，已跳过",
      objectId: pageId
    });
    return targetParentId;
  }
  context.restoringPages.add(pageId);
  try {
    const artifact = await readPageArtifact(context.runDir, pageId);
    for (const warning of collectPageArtifactRestoreWarnings(artifact, pageId)) {
      addWarning(context.report, warning);
    }
    const title = extractTitle(artifact.page) || fallbackTitle || "恢复页面";
    const createBody = createPageBody(targetParentId, artifact.page, title, context.report, pageId);
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
    const oldBlockId = String(block.id ?? "");
    const rawChildBlocks = Array.isArray(block.children) ? (block.children as NotionObject[]) : [];
    const conversion = convertBlockForRestore(block);
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
        await restorePageArtifact(context, conversion.childPageId, parentBlockId, conversion.title);
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

export function convertBlockForRestore(block: NotionObject): BlockConversion {
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
      const media = sanitizeMediaPayload(payload, warnings);
      if (!media) {
        return skipBlock("local_file_upload_not_implemented", `${type} 区块需要本地文件上传，当前版本已跳过`, oldBlockId);
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

function createPageBody(targetParentId: string, sourcePage: NotionObject, title: string, report: RestoreReport, oldPageId: string): NotionObject {
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
  return {
    parent: {
      type: "page_id",
      page_id: targetParentId
    },
    properties: {
      title: {
        title: textRichText(title)
      }
    },
    ...(icon ? { icon } : {}),
    ...(cover ? { cover } : {})
  };
}

function finishReport(report: RestoreReport): void {
  const failedItems = report.items.filter((item) => item.status === "failed").length;
  const skippedItems = report.items.filter((item) => item.status === "skipped").length;
  report.summary.failedItems = failedItems;
  report.summary.skippedItems = skippedItems;
  report.summary.warningCount = report.warnings.length;
  report.finishedAt = nowIso();
  report.status = resolveRestoreStatus({
    createdPages: report.summary.createdPages,
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

async function readJson<T>(filePath: string): Promise<T> {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text) as T;
}

function pageArtifactPath(runDir: string, pageId: string): string {
  return path.join(runDir, "pages", `${pageId}.json`);
}

function addSkippedItem(report: RestoreReport, item: BackupRunItem, message: string): void {
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

export function resolveRestoreStatus(input: { createdPages: number; failedItems: number; skippedItems: number; errorCount: number }): RestoreStatus {
  if (input.failedItems > 0 || input.skippedItems > 0 || input.errorCount > 0) {
    return input.createdPages > 0 ? "partial_failed" : "failed";
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

function sanitizeMediaPayload(payload: NotionObject, warnings: RestoreWarning[]): NotionObject | null {
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
  warnings.push({
    code: "file_upload_not_implemented",
    message: "本地文件上传恢复尚未实现，已跳过 Notion 托管文件"
  });
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

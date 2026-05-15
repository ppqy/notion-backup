import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type {
  BackupRunDetail,
  PageResult,
  RestoreReport,
  RestoreRunDetail,
  RestoreRunItem,
  RestoreRunStatus,
  RestoreRunSummary
} from "../../shared/types.js";
import { db } from "../db.js";
import { badRequest, notFound } from "../errors.js";
import { nowIso } from "../time.js";
import { getRun } from "./runRepository.js";

type RestoreRunRow = {
  id: string;
  restore_key: string;
  source_run_id: string;
  source_run_key: string;
  target_parent_id: string;
  status: RestoreRunStatus;
  status_message: string | null;
  current_phase: string | null;
  current_item_title: string | null;
  total_items: number;
  processed_items: number;
  failed_items: number;
  skipped_items: number;
  warning_count: number;
  error_count: number;
  created_pages: number;
  created_data_sources: number;
  created_blocks: number;
  manifest_path: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested_at: string | null;
  created_at: string;
  updated_at: string;
};

type RestoreItemRow = {
  id: string;
  restore_run_id: string;
  object_id: string;
  object_type: "page" | "data_source";
  title: string;
  status: RestoreRunItem["status"];
  new_page_id: string | null;
  new_data_source_id: string | null;
  warning_count: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export function createRestoreRun(sourceRun: BackupRunDetail, targetParentId: string): RestoreRunDetail {
  const timestamp = nowIso();
  const row: RestoreRunRow = {
    id: nanoid(),
    restore_key: `${timestamp.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z")}_${nanoid(6)}`,
    source_run_id: sourceRun.id,
    source_run_key: sourceRun.runKey,
    target_parent_id: targetParentId,
    status: "queued",
    status_message: null,
    current_phase: null,
    current_item_title: null,
    total_items: sourceRun.items.length,
    processed_items: 0,
    failed_items: 0,
    skipped_items: 0,
    warning_count: 0,
    error_count: 0,
    created_pages: 0,
    created_data_sources: 0,
    created_blocks: 0,
    manifest_path: null,
    started_at: null,
    finished_at: null,
    cancel_requested_at: null,
    created_at: timestamp,
    updated_at: timestamp
  };
  const insertRun = db.prepare(
    `INSERT INTO restore_runs (
      id, restore_key, source_run_id, source_run_key, target_parent_id, status, status_message, current_phase, current_item_title,
      total_items, processed_items, failed_items, skipped_items, warning_count, error_count, created_pages, created_data_sources, created_blocks,
      manifest_path, started_at, finished_at, cancel_requested_at, created_at, updated_at
    ) VALUES (
      @id, @restore_key, @source_run_id, @source_run_key, @target_parent_id, @status, @status_message, @current_phase, @current_item_title,
      @total_items, @processed_items, @failed_items, @skipped_items, @warning_count, @error_count, @created_pages, @created_data_sources, @created_blocks,
      @manifest_path, @started_at, @finished_at, @cancel_requested_at, @created_at, @updated_at
    )`
  );
  const insertItem = db.prepare(
    `INSERT INTO restore_run_items (
      id, restore_run_id, object_id, object_type, title, status, new_page_id, new_data_source_id, warning_count, error_message,
      started_at, finished_at, created_at, updated_at
    ) VALUES (
      @id, @restore_run_id, @object_id, @object_type, @title, @status, @new_page_id, @new_data_source_id, @warning_count, @error_message,
      @started_at, @finished_at, @created_at, @updated_at
    )`
  );
  const create = db.transaction(() => {
    insertRun.run(row);
    for (const item of sourceRun.items) {
      insertItem.run({
        id: nanoid(),
        restore_run_id: row.id,
        object_id: item.objectId,
        object_type: item.objectType,
        title: item.title,
        status: "queued",
        new_page_id: null,
        new_data_source_id: null,
        warning_count: 0,
        error_message: null,
        started_at: null,
        finished_at: null,
        created_at: timestamp,
        updated_at: timestamp
      });
    }
  });
  create();
  return getRestoreRun(row.id);
}

export function claimNextQueuedRestoreRun(): RestoreRunDetail | null {
  markUnstartedRestoreCancelRequestedRunsCanceled();
  const row = db.prepare("SELECT * FROM restore_runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").get() as RestoreRunRow | undefined;
  if (!row) {
    return null;
  }
  updateRestoreRun(row.id, {
    status: "running",
    started_at: nowIso(),
    current_phase: "准备恢复"
  });
  return getRestoreRun(row.id);
}

export function listRestoreRuns(options: { page: number; pageSize: number; status?: RestoreRunStatus; sourceRunId?: string; q?: string }): PageResult<RestoreRunSummary> {
  markUnstartedRestoreCancelRequestedRunsCanceled();
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (options.status) {
    clauses.push("status = @status");
    params.status = options.status;
  }
  if (options.sourceRunId) {
    clauses.push("source_run_id = @sourceRunId");
    params.sourceRunId = options.sourceRunId;
  }
  if (options.q) {
    clauses.push("(source_run_key LIKE @q OR target_parent_id LIKE @q OR restore_key LIKE @q)");
    params.q = `%${options.q}%`;
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM restore_runs ${where}`).get(params) as { count: number }).count;
  const page = Math.max(1, options.page);
  const pageSize = Math.min(100, Math.max(10, options.pageSize));
  const rows = db
    .prepare(
      `SELECT * FROM restore_runs ${where}
       ORDER BY created_at DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({
      ...params,
      limit: pageSize,
      offset: (page - 1) * pageSize
    }) as RestoreRunRow[];
  return {
    items: rows.map(mapRestoreRunRow),
    page,
    pageSize,
    total
  };
}

export function getRestoreRun(id: string): RestoreRunDetail {
  const row = db.prepare("SELECT * FROM restore_runs WHERE id = ?").get(id) as RestoreRunRow | undefined;
  if (!row) {
    throw notFound("恢复记录不存在");
  }
  const items = db.prepare("SELECT * FROM restore_run_items WHERE restore_run_id = ? ORDER BY created_at ASC").all(id) as RestoreItemRow[];
  return {
    ...mapRestoreRunRow(row),
    items: items.map(mapRestoreItemRow),
    report: readRestoreReport(row)
  };
}

export function getLatestRestoreRunForSource(sourceRunId: string): RestoreRunDetail | null {
  const row = db.prepare("SELECT * FROM restore_runs WHERE source_run_id = ? ORDER BY created_at DESC LIMIT 1").get(sourceRunId) as RestoreRunRow | undefined;
  return row ? getRestoreRun(row.id) : null;
}

export function updateRestoreRun(id: string, updates: Partial<Record<keyof RestoreRunRow, unknown>>): void {
  const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return;
  }
  const assignments = entries.map(([key]) => `${key} = @${key}`).join(", ");
  db.prepare(`UPDATE restore_runs SET ${assignments}, updated_at = @updated_at WHERE id = @id`).run({
    ...Object.fromEntries(entries),
    id,
    updated_at: nowIso()
  });
}

export function updateRestoreRunItem(id: string, updates: Partial<Record<keyof RestoreItemRow, unknown>>): void {
  const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return;
  }
  const assignments = entries.map(([key]) => `${key} = @${key}`).join(", ");
  db.prepare(`UPDATE restore_run_items SET ${assignments}, updated_at = @updated_at WHERE id = @id`).run({
    ...Object.fromEntries(entries),
    id,
    updated_at: nowIso()
  });
}

export function requestRestoreCancel(id: string): RestoreRunSummary {
  const restore = getRestoreRun(id);
  if (!["queued", "running", "cancel_requested"].includes(restore.status)) {
    throw badRequest("只有排队中或运行中的恢复可以取消");
  }
  if (restore.status === "queued") {
    const timestamp = nowIso();
    updateRestoreRun(id, {
      status: "canceled",
      cancel_requested_at: timestamp,
      finished_at: timestamp,
      current_phase: "已取消",
      status_message: "用户已取消，恢复未开始"
    });
    markRestoreItemsCanceled(id, "用户取消，未执行");
    return mapRestoreRunRow(db.prepare("SELECT * FROM restore_runs WHERE id = ?").get(id) as RestoreRunRow);
  }
  if (restore.status === "running") {
    updateRestoreRun(id, {
      status: "cancel_requested",
      cancel_requested_at: nowIso(),
      status_message: "用户请求取消"
    });
  }
  return mapRestoreRunRow(db.prepare("SELECT * FROM restore_runs WHERE id = ?").get(id) as RestoreRunRow);
}

export function restoreCancelRequested(id: string): boolean {
  const row = db.prepare("SELECT status FROM restore_runs WHERE id = ?").get(id) as { status?: RestoreRunStatus } | undefined;
  return row?.status === "cancel_requested";
}

export function markRestoreItemsCanceled(restoreRunId: string, message: string): void {
  const timestamp = nowIso();
  db.prepare(
    `UPDATE restore_run_items
     SET status = 'skipped',
         error_message = COALESCE(error_message, @message),
         finished_at = COALESCE(finished_at, @timestamp),
         updated_at = @timestamp
     WHERE restore_run_id = @restoreRunId AND status IN ('queued', 'running')`
  ).run({
    restoreRunId,
    message,
    timestamp
  });
}

export function updateRestoreRunFromReport(id: string, report: RestoreReport, statusMessage?: string): void {
  updateRestoreRun(id, {
    status: report.status,
    status_message: statusMessage ?? (report.status === "canceled" ? "用户已取消，已创建内容保留" : restoreStatusMessage(report.status)),
    current_phase: report.status === "canceled" ? "已取消" : "完成",
    current_item_title: null,
    processed_items: report.items.length,
    failed_items: report.summary.failedItems,
    skipped_items: report.summary.skippedItems,
    warning_count: report.summary.warningCount,
    error_count: report.errors.length,
    created_pages: report.summary.createdPages,
    created_data_sources: report.summary.createdDataSources,
    created_blocks: report.summary.createdBlocks,
    manifest_path: report.manifestPath,
    finished_at: report.finishedAt
  });
}

export function markUnstartedRestoreCancelRequestedRunsCanceled(): void {
  const timestamp = nowIso();
  db.prepare(
    `UPDATE restore_runs
     SET status = 'canceled',
         status_message = COALESCE(status_message, '用户已取消，恢复未开始'),
         current_phase = '已取消',
         finished_at = COALESCE(finished_at, @timestamp),
         updated_at = @timestamp
     WHERE status = 'cancel_requested' AND started_at IS NULL`
  ).run({ timestamp });
  db.prepare(
    `UPDATE restore_run_items
     SET status = 'skipped',
         error_message = COALESCE(error_message, '用户取消，未执行'),
         finished_at = COALESCE(finished_at, @timestamp),
         updated_at = @timestamp
     WHERE restore_run_id IN (SELECT id FROM restore_runs WHERE status = 'canceled' AND started_at IS NULL)
       AND status IN ('queued', 'running')`
  ).run({ timestamp });
}

function readRestoreReport(row: RestoreRunRow): RestoreReport | null {
  if (!row.manifest_path) {
    return null;
  }
  try {
    const sourceRun = getRun(row.source_run_id);
    if (!sourceRun.artifactDir) {
      return null;
    }
    const filePath = path.join(sourceRun.artifactDir, row.manifest_path);
    if (!existsSync(filePath)) {
      return null;
    }
    return JSON.parse(readFileSync(filePath, "utf8")) as RestoreReport;
  } catch {
    return null;
  }
}

function restoreStatusMessage(status: RestoreRunStatus): string {
  switch (status) {
    case "succeeded":
      return "恢复完成";
    case "partial_failed":
      return "完成，但部分项目失败";
    case "failed":
      return "恢复失败";
    case "canceled":
      return "用户已取消，已创建内容保留";
    default:
      return "恢复处理中";
  }
}

function mapRestoreRunRow(row: RestoreRunRow): RestoreRunSummary {
  return {
    id: row.id,
    restoreKey: row.restore_key,
    sourceRunId: row.source_run_id,
    sourceRunKey: row.source_run_key,
    targetParentId: row.target_parent_id,
    status: row.status,
    statusMessage: row.status_message,
    currentPhase: row.current_phase,
    currentItemTitle: row.current_item_title,
    totalItems: row.total_items,
    processedItems: row.processed_items,
    failedItems: row.failed_items,
    skippedItems: row.skipped_items,
    warningCount: row.warning_count,
    errorCount: row.error_count,
    createdPages: row.created_pages,
    createdDataSources: row.created_data_sources,
    createdBlocks: row.created_blocks,
    manifestPath: row.manifest_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at
  };
}

function mapRestoreItemRow(row: RestoreItemRow): RestoreRunItem {
  return {
    id: row.id,
    objectId: row.object_id,
    objectType: row.object_type,
    title: row.title,
    status: row.status,
    newPageId: row.new_page_id,
    newDataSourceId: row.new_data_source_id,
    warningCount: row.warning_count,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

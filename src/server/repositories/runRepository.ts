import { existsSync, rmSync } from "node:fs";
import { nanoid } from "nanoid";
import type { BackupPlan, BackupRunDetail, BackupRunItem, BackupRunStatus, BackupRunSummary, BackupRunTrigger, PageResult } from "../../shared/types.js";
import { db } from "../db.js";
import { badRequest, notFound } from "../errors.js";
import { parseJson, stringifyJson } from "../json.js";
import { nowIso } from "../time.js";

type RunRow = {
  id: string;
  run_key: string;
  plan_id: string | null;
  plan_snapshot_json: string;
  trigger_type: BackupRunTrigger;
  status: BackupRunStatus;
  status_message: string | null;
  current_phase: string | null;
  current_item_title: string | null;
  total_items: number | null;
  processed_items: number;
  failed_items: number;
  skipped_files: number;
  artifact_dir: string | null;
  artifact_size_bytes: number | null;
  archive_path: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancel_requested_at: string | null;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  run_id: string;
  object_id: string;
  object_type: "page" | "data_source";
  title: string;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
  error_message: string | null;
  artifact_path: string | null;
  metadata_json: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export function createBackupRun(plan: BackupPlan, triggerType: BackupRunTrigger): BackupRunSummary {
  const now = nowIso();
  const run = {
    id: nanoid(),
    run_key: `${now.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z")}_${nanoid(6)}`,
    plan_id: plan.id,
    plan_snapshot_json: stringifyJson(plan),
    trigger_type: triggerType,
    status: "queued" as BackupRunStatus,
    status_message: null,
    current_phase: null,
    current_item_title: null,
    total_items: plan.selectedContent.length,
    processed_items: 0,
    failed_items: 0,
    skipped_files: 0,
    artifact_dir: null,
    artifact_size_bytes: null,
    archive_path: null,
    started_at: null,
    finished_at: null,
    cancel_requested_at: null,
    created_at: now,
    updated_at: now
  };
  db.prepare(
    `INSERT INTO backup_runs (
      id, run_key, plan_id, plan_snapshot_json, trigger_type, status, status_message, current_phase, current_item_title,
      total_items, processed_items, failed_items, skipped_files, artifact_dir, artifact_size_bytes, archive_path,
      started_at, finished_at, cancel_requested_at, created_at, updated_at
    ) VALUES (
      @id, @run_key, @plan_id, @plan_snapshot_json, @trigger_type, @status, @status_message, @current_phase, @current_item_title,
      @total_items, @processed_items, @failed_items, @skipped_files, @artifact_dir, @artifact_size_bytes, @archive_path,
      @started_at, @finished_at, @cancel_requested_at, @created_at, @updated_at
    )`
  ).run(run);
  return mapRunRow(run);
}

export function claimNextQueuedRun(): BackupRunDetail | null {
  const row = db.prepare("SELECT * FROM backup_runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").get() as RunRow | undefined;
  if (!row) {
    return null;
  }
  updateRun(row.id, {
    status: "running",
    started_at: nowIso(),
    current_phase: "准备备份"
  });
  return getRun(row.id);
}

export function listRuns(options: {
  page: number;
  pageSize: number;
  planId?: string;
  status?: BackupRunStatus;
  triggerType?: BackupRunTrigger;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
}): PageResult<BackupRunSummary> {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (options.planId) {
    clauses.push("plan_id = @planId");
    params.planId = options.planId;
  }
  if (options.status) {
    clauses.push("status = @status");
    params.status = options.status;
  }
  if (options.triggerType) {
    clauses.push("trigger_type = @triggerType");
    params.triggerType = options.triggerType;
  }
  if (options.dateFrom) {
    clauses.push("created_at >= @dateFrom");
    params.dateFrom = options.dateFrom;
  }
  if (options.dateTo) {
    clauses.push("created_at <= @dateTo");
    params.dateTo = options.dateTo;
  }
  if (options.q) {
    clauses.push("plan_snapshot_json LIKE @q");
    params.q = `%${options.q}%`;
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM backup_runs ${where}`).get(params) as { count: number }).count;
  const page = Math.max(1, options.page);
  const pageSize = Math.min(100, Math.max(10, options.pageSize));
  const rows = db
    .prepare(
      `SELECT * FROM backup_runs ${where}
       ORDER BY created_at DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({
      ...params,
      limit: pageSize,
      offset: (page - 1) * pageSize
    }) as RunRow[];
  return {
    items: rows.map(mapRunRow),
    page,
    pageSize,
    total
  };
}

export function getRun(id: string): BackupRunDetail {
  const row = db.prepare("SELECT * FROM backup_runs WHERE id = ?").get(id) as RunRow | undefined;
  if (!row) {
    throw notFound("备份记录不存在");
  }
  const items = db.prepare("SELECT * FROM backup_run_items WHERE run_id = ? ORDER BY created_at ASC").all(id) as ItemRow[];
  return {
    ...mapRunRow(row),
    artifactDir: row.artifact_dir,
    manifestAvailable: Boolean(row.artifact_dir && existsSync(`${row.artifact_dir}/manifest.json`)),
    archiveAvailable: Boolean(row.archive_path && existsSync(row.archive_path)),
    items: items.map(mapItemRow),
    planSnapshot: parseJson<Record<string, unknown> | null>(row.plan_snapshot_json, null)
  };
}

export function updateRun(id: string, updates: Partial<Record<keyof RunRow, unknown>>): void {
  const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return;
  }
  const assignments = entries.map(([key]) => `${key} = @${key}`).join(", ");
  db.prepare(`UPDATE backup_runs SET ${assignments}, updated_at = @updated_at WHERE id = @id`).run({
    ...Object.fromEntries(entries),
    id,
    updated_at: nowIso()
  });
}

export function createRunItem(runId: string, objectId: string, objectType: "page" | "data_source", title: string): BackupRunItem {
  const timestamp = nowIso();
  const item = {
    id: nanoid(),
    run_id: runId,
    object_id: objectId,
    object_type: objectType,
    title,
    status: "queued" as const,
    error_message: null,
    artifact_path: null,
    metadata_json: null,
    started_at: null,
    finished_at: null,
    created_at: timestamp,
    updated_at: timestamp
  };
  db.prepare(
    `INSERT INTO backup_run_items (
      id, run_id, object_id, object_type, title, status, error_message, artifact_path, metadata_json,
      started_at, finished_at, created_at, updated_at
    ) VALUES (
      @id, @run_id, @object_id, @object_type, @title, @status, @error_message, @artifact_path, @metadata_json,
      @started_at, @finished_at, @created_at, @updated_at
    )`
  ).run(item);
  return mapItemRow(item);
}

export function updateRunItem(id: string, updates: Partial<Record<keyof ItemRow, unknown>>): void {
  const entries = Object.entries(updates).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return;
  }
  const assignments = entries.map(([key]) => `${key} = @${key}`).join(", ");
  db.prepare(`UPDATE backup_run_items SET ${assignments}, updated_at = @updated_at WHERE id = @id`).run({
    ...Object.fromEntries(entries),
    id,
    updated_at: nowIso()
  });
}

export function requestRunCancel(id: string): BackupRunSummary {
  const run = getRun(id);
  if (!["queued", "running"].includes(run.status)) {
    throw badRequest("只有排队中或运行中的备份可以取消");
  }
  updateRun(id, {
    status: "cancel_requested",
    cancel_requested_at: nowIso(),
    status_message: "用户请求取消"
  });
  return mapRunRow(db.prepare("SELECT * FROM backup_runs WHERE id = ?").get(id) as RunRow);
}

export function deleteRun(id: string): void {
  const run = getRun(id);
  if (["queued", "running", "cancel_requested"].includes(run.status)) {
    throw badRequest("运行中或排队中的备份需要先取消后才能删除");
  }
  if (run.artifactDir && existsSync(run.artifactDir)) {
    try {
      rmSync(run.artifactDir, { recursive: true, force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除文件失败";
      throw badRequest(`删除备份文件失败：${message}`);
    }
  }
  db.prepare("DELETE FROM backup_runs WHERE id = ?").run(id);
}

export function getRunningRuns(): BackupRunSummary[] {
  const rows = db
    .prepare("SELECT * FROM backup_runs WHERE status IN ('queued', 'running', 'cancel_requested') ORDER BY created_at ASC")
    .all() as RunRow[];
  return rows.map(mapRunRow);
}

export function getLatestRun(): BackupRunSummary | null {
  const row = db.prepare("SELECT * FROM backup_runs ORDER BY created_at DESC LIMIT 1").get() as RunRow | undefined;
  return row ? mapRunRow(row) : null;
}

function mapRunRow(row: RunRow): BackupRunSummary {
  const snapshot = parseJson<{ name?: string }>(row.plan_snapshot_json, {});
  return {
    id: row.id,
    runKey: row.run_key,
    planId: row.plan_id,
    planName: snapshot.name || "已删除计划",
    triggerType: row.trigger_type,
    status: row.status,
    statusMessage: row.status_message,
    currentPhase: row.current_phase,
    currentItemTitle: row.current_item_title,
    totalItems: row.total_items,
    processedItems: row.processed_items,
    failedItems: row.failed_items,
    skippedFiles: row.skipped_files,
    artifactSizeBytes: row.artifact_size_bytes,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at
  };
}

function mapItemRow(row: ItemRow): BackupRunItem {
  return {
    id: row.id,
    objectId: row.object_id,
    objectType: row.object_type,
    title: row.title,
    status: row.status,
    errorMessage: row.error_message,
    artifactPath: row.artifact_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}

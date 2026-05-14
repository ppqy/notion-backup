import { nanoid } from "nanoid";
import type { BackupPlan, BackupPlanStatus, SelectedContent } from "../../shared/types.js";
import { db } from "../db.js";
import { badRequest, notFound } from "../errors.js";
import { parseJson, stringifyJson } from "../json.js";
import { nextRunAt, validateSchedule } from "../schedule.js";
import { nowIso } from "../time.js";
import type { BackupPlanInput } from "../validation.js";
import { getConnectionStatus } from "./notionRepository.js";

type PlanRow = {
  id: string;
  name: string;
  selected_content_json: string;
  schedule_enabled: number;
  schedule_preset: BackupPlan["schedulePreset"];
  cron_expression: string | null;
  timezone: string;
  next_run_at: string | null;
  include_comments: number;
  include_child_pages: number;
  download_notion_files: number;
  mirror_external_files: number;
  file_size_limit_bytes: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export function listPlans(options: { q?: string; status?: BackupPlanStatus }): BackupPlan[] {
  const clauses = ["deleted_at IS NULL"];
  const params: Record<string, unknown> = {};
  if (options.q) {
    clauses.push("name LIKE @q");
    params.q = `%${options.q}%`;
  }
  const rows = db
    .prepare(
      `SELECT * FROM backup_plans
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC`
    )
    .all(params) as PlanRow[];
  const plans = rows.map(mapPlanRow);
  return options.status ? plans.filter((plan) => plan.status === options.status) : plans;
}

export function getPlan(id: string): BackupPlan {
  const row = db.prepare("SELECT * FROM backup_plans WHERE id = ? AND deleted_at IS NULL").get(id) as PlanRow | undefined;
  if (!row) {
    throw notFound("备份计划不存在");
  }
  return mapPlanRow(row);
}

export function createPlan(input: BackupPlanInput): { plan: BackupPlan; warnings: string[] } {
  const timestamp = nowIso();
  const prepared = preparePlanInput(input);
  const plan = {
    id: nanoid(),
    name: input.name.trim(),
    selected_content_json: stringifyJson(input.selectedContent),
    schedule_enabled: prepared.scheduleEnabled ? 1 : 0,
    schedule_preset: input.schedulePreset,
    cron_expression: input.cronExpression || null,
    timezone: input.timezone,
    next_run_at: prepared.nextRunAt,
    include_comments: input.includeComments ? 1 : 0,
    include_child_pages: input.includeChildPages ? 1 : 0,
    download_notion_files: input.downloadNotionFiles ? 1 : 0,
    mirror_external_files: input.mirrorExternalFiles ? 1 : 0,
    file_size_limit_bytes: input.fileSizeLimitBytes,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp
  };
  db.prepare(
    `INSERT INTO backup_plans (
      id, name, selected_content_json, schedule_enabled, schedule_preset, cron_expression, timezone, next_run_at,
      include_comments, include_child_pages, download_notion_files, mirror_external_files, file_size_limit_bytes,
      deleted_at, created_at, updated_at
    ) VALUES (
      @id, @name, @selected_content_json, @schedule_enabled, @schedule_preset, @cron_expression, @timezone, @next_run_at,
      @include_comments, @include_child_pages, @download_notion_files, @mirror_external_files, @file_size_limit_bytes,
      @deleted_at, @created_at, @updated_at
    )`
  ).run(plan);
  return {
    plan: mapPlanRow(plan),
    warnings: prepared.warnings
  };
}

export function updatePlan(id: string, input: BackupPlanInput): { plan: BackupPlan; warnings: string[] } {
  getPlan(id);
  const prepared = preparePlanInput(input);
  db.prepare(
    `UPDATE backup_plans SET
      name = @name,
      selected_content_json = @selected_content_json,
      schedule_enabled = @schedule_enabled,
      schedule_preset = @schedule_preset,
      cron_expression = @cron_expression,
      timezone = @timezone,
      next_run_at = @next_run_at,
      include_comments = @include_comments,
      include_child_pages = @include_child_pages,
      download_notion_files = @download_notion_files,
      mirror_external_files = @mirror_external_files,
      file_size_limit_bytes = @file_size_limit_bytes,
      updated_at = @updated_at
     WHERE id = @id`
  ).run({
    id,
    name: input.name.trim(),
    selected_content_json: stringifyJson(input.selectedContent),
    schedule_enabled: prepared.scheduleEnabled ? 1 : 0,
    schedule_preset: input.schedulePreset,
    cron_expression: input.cronExpression || null,
    timezone: input.timezone,
    next_run_at: prepared.nextRunAt,
    include_comments: input.includeComments ? 1 : 0,
    include_child_pages: input.includeChildPages ? 1 : 0,
    download_notion_files: input.downloadNotionFiles ? 1 : 0,
    mirror_external_files: input.mirrorExternalFiles ? 1 : 0,
    file_size_limit_bytes: input.fileSizeLimitBytes,
    updated_at: nowIso()
  });
  return {
    plan: getPlan(id),
    warnings: prepared.warnings
  };
}

export function softDeletePlan(id: string): void {
  getPlan(id);
  db.prepare("UPDATE backup_plans SET deleted_at = ?, schedule_enabled = 0, next_run_at = NULL, updated_at = ? WHERE id = ?").run(
    nowIso(),
    nowIso(),
    id
  );
}

export function setPlanNextRun(id: string, nextRun: string | null): void {
  db.prepare("UPDATE backup_plans SET next_run_at = ?, updated_at = ? WHERE id = ?").run(nextRun, nowIso(), id);
}

export function duePlans(now = nowIso()): BackupPlan[] {
  const rows = db
    .prepare(
      `SELECT * FROM backup_plans
       WHERE deleted_at IS NULL
         AND schedule_enabled = 1
         AND next_run_at IS NOT NULL
         AND next_run_at <= ?
       ORDER BY next_run_at ASC`
    )
    .all(now) as PlanRow[];
  return rows.map(mapPlanRow);
}

function preparePlanInput(input: BackupPlanInput): { scheduleEnabled: boolean; nextRunAt: string | null; warnings: string[] } {
  const warnings: string[] = [];
  let scheduleEnabled = input.scheduleEnabled;
  let computedNextRun: string | null = null;
  if (scheduleEnabled) {
    const missing = validateForScheduling(input);
    if (missing.length > 0) {
      scheduleEnabled = false;
      warnings.push(`计划已保存，但定时备份未开启：${missing.join("；")}`);
    } else {
      computedNextRun = nextRunAt(input.schedulePreset, input.cronExpression ?? null, input.timezone);
    }
  }
  return {
    scheduleEnabled,
    nextRunAt: scheduleEnabled ? computedNextRun : null,
    warnings
  };
}

export function validateForManualRun(plan: BackupPlan): string[] {
  const missing: string[] = [];
  if (!getConnectionStatus().configured) {
    missing.push("请先设置有效的 Notion token");
  }
  if (plan.selectedContent.length === 0) {
    missing.push("请至少选择一个页面或数据源");
  }
  return missing;
}

function validateForScheduling(input: BackupPlanInput): string[] {
  const missing: string[] = [];
  if (!getConnectionStatus().configured) {
    missing.push("请先设置有效的 Notion token");
  }
  if (input.selectedContent.length === 0) {
    missing.push("请至少选择一个页面或数据源");
  }
  missing.push(...validateSchedule(input.schedulePreset, input.cronExpression ?? null, input.timezone));
  return missing;
}

function mapPlanRow(row: PlanRow): BackupPlan {
  const selectedContent = parseJson<SelectedContent[]>(row.selected_content_json, []);
  const scheduleEnabled = row.schedule_enabled === 1;
  return {
    id: row.id,
    name: row.name,
    status: getPlanStatus(selectedContent, scheduleEnabled),
    selectedContent,
    scheduleEnabled,
    schedulePreset: row.schedule_preset,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    nextRunAt: row.next_run_at,
    includeComments: row.include_comments === 1,
    includeChildPages: row.include_child_pages === 1,
    downloadNotionFiles: row.download_notion_files === 1,
    mirrorExternalFiles: row.mirror_external_files === 1,
    fileSizeLimitBytes: row.file_size_limit_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getPlanStatus(selectedContent: SelectedContent[], scheduleEnabled: boolean): BackupPlanStatus {
  if (selectedContent.length === 0 || !getConnectionStatus().configured) {
    return "incomplete";
  }
  return scheduleEnabled ? "schedule_enabled" : "schedule_disabled";
}

import { DEFAULT_RESTORE_OPTIONS } from "../shared/constants.js";
import type { RestoreOptions, RestoreReport, RestoreReportMappings, RestoreReportSummary, RestoreWarning } from "../shared/types.js";
import { summarizeRestoreWarnings } from "./restoreWarnings.js";

export function defaultRestoreOptions(): RestoreOptions {
  return { ...DEFAULT_RESTORE_OPTIONS };
}

export function defaultRestoreReportSummary(overrides: Partial<RestoreReportSummary> = {}): RestoreReportSummary {
  return {
    createdPages: 0,
    createdDataSourceEntryPages: 0,
    createdDataSources: 0,
    createdBlocks: 0,
    createdViews: 0,
    createdComments: 0,
    skippedItems: 0,
    failedItems: 0,
    warningCount: 0,
    ...coerceNumericMetrics(overrides)
  };
}

export function defaultRestoreReportMappings(overrides: Partial<RestoreReportMappings> = {}): RestoreReportMappings {
  return {
    pages: readStringMap(overrides.pages),
    blocks: readStringMap(overrides.blocks),
    dataSources: readStringMap(overrides.dataSources),
    files: readStringMap(overrides.files),
    properties: readStringMap(overrides.properties),
    views: readStringMap(overrides.views),
    databases: readStringMap(overrides.databases),
    comments: readStringMap(overrides.comments)
  };
}

export function normalizeRestoreOptions(value: unknown): RestoreOptions {
  if (!isRecord(value)) {
    return defaultRestoreOptions();
  }
  return {
    restoreComments: value.restoreComments === true,
    restoreViews: value.restoreViews === true,
    importExternalUrls: value.importExternalUrls === true,
    relationStrategy: value.relationStrategy === "mapped_only" ? "mapped_only" : "mapped_only"
  };
}

export function parseRestoreOptionsJson(value: string | null): RestoreOptions {
  if (!value) {
    return defaultRestoreOptions();
  }
  try {
    return normalizeRestoreOptions(JSON.parse(value));
  } catch {
    return defaultRestoreOptions();
  }
}

export function normalizeRestoreReportSummary(value: unknown): RestoreReportSummary {
  return defaultRestoreReportSummary(isRecord(value) ? (value as Partial<RestoreReportSummary>) : {});
}

export function parseRestoreSummaryJson(value: string | null): RestoreReportSummary | null {
  if (!value) {
    return null;
  }
  try {
    return normalizeRestoreReportSummary(JSON.parse(value));
  } catch {
    return null;
  }
}

export function normalizeRestoreReport(value: unknown): RestoreReport | null {
  if (!isRecord(value)) {
    return null;
  }
  const warnings = readRestoreWarnings(value.warnings);
  const summary = normalizeRestoreReportSummary(value.summary);
  summary.warningCount = warnings.length;
  return {
    restoreId: typeof value.restoreId === "string" ? value.restoreId : "",
    sourceRunId: typeof value.sourceRunId === "string" ? value.sourceRunId : "",
    sourceRunKey: typeof value.sourceRunKey === "string" ? value.sourceRunKey : "",
    targetParentId: typeof value.targetParentId === "string" ? value.targetParentId : "",
    options: normalizeRestoreOptions(value.options),
    status: isRestoreStatus(value.status) ? value.status : "failed",
    startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null,
    summary,
    mappings: defaultRestoreReportMappings(isRecord(value.mappings) ? (value.mappings as Partial<RestoreReportMappings>) : {}),
    items: Array.isArray(value.items) ? (value.items as RestoreReport["items"]) : [],
    warnings,
    warningSummaries: summarizeRestoreWarnings(warnings),
    errors: Array.isArray(value.errors) ? value.errors.filter((error): error is string => typeof error === "string") : [],
    manifestPath: typeof value.manifestPath === "string" ? value.manifestPath : null
  };
}

function coerceNumericMetrics(value: Partial<RestoreReportSummary>): Partial<RestoreReportSummary> {
  const metrics: Partial<RestoreReportSummary> = {};
  for (const [key, metric] of Object.entries(value)) {
    if (typeof metric === "number" && Number.isFinite(metric)) {
      metrics[key] = metric;
    }
  }
  return metrics;
}

function readStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function readRestoreWarnings(value: unknown): RestoreWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((warning): RestoreWarning[] => {
    if (!isRecord(warning) || typeof warning.code !== "string" || typeof warning.message !== "string") {
      return [];
    }
    return [
      {
        code: warning.code,
        message: warning.message,
        ...(typeof warning.objectId === "string" ? { objectId: warning.objectId } : {}),
        ...(typeof warning.blockId === "string" ? { blockId: warning.blockId } : {}),
        ...("details" in warning ? { details: warning.details } : {})
      }
    ];
  });
}

function isRestoreStatus(value: unknown): value is RestoreReport["status"] {
  return value === "running" || value === "succeeded" || value === "partial_failed" || value === "failed" || value === "canceled";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

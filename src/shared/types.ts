export type SetupStatus = {
  needsSetup: boolean;
  hasAdmin: boolean;
};

export type SessionUser = {
  id: string;
  username: string;
};

export type SessionResponse = {
  user: SessionUser | null;
  needsSetup: boolean;
};

export type EncryptionKeyInfo = {
  source: "env" | "generated";
  value?: string;
  acknowledged: boolean;
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type NotionObjectType = "page" | "data_source";

export type DiscoveredContent = {
  id: string;
  objectId: string;
  objectType: NotionObjectType;
  title: string;
  parent: string | null;
  url: string | null;
  lastEditedTime: string | null;
  source: "search" | "manual";
  discoveredAt: string;
  updatedAt: string;
};

export type NotionConnectionStatus = {
  configured: boolean;
  identity: Record<string, unknown> | null;
  validatedAt: string | null;
};

export type SchedulePreset = "hourly" | "daily" | "weekly" | "monthly" | "custom";

export type BackupPlanStatus = "incomplete" | "schedule_enabled" | "schedule_disabled";

export type SelectedContent = {
  objectId: string;
  objectType: NotionObjectType;
  title: string;
};

export type BackupPlan = {
  id: string;
  name: string;
  status: BackupPlanStatus;
  selectedContent: SelectedContent[];
  scheduleEnabled: boolean;
  schedulePreset: SchedulePreset;
  cronExpression: string | null;
  timezone: string;
  nextRunAt: string | null;
  includeComments: boolean;
  includeChildPages: boolean;
  downloadNotionFiles: boolean;
  mirrorExternalFiles: boolean;
  fileSizeLimitBytes: number | null;
  createdAt: string;
  updatedAt: string;
};

export type BackupRunStatus =
  | "queued"
  | "running"
  | "cancel_requested"
  | "succeeded"
  | "partial_failed"
  | "failed"
  | "canceled";

export type BackupRunTrigger = "manual" | "scheduled";

export type BackupRunSummary = {
  id: string;
  runKey: string;
  planId: string | null;
  planName: string;
  triggerType: BackupRunTrigger;
  status: BackupRunStatus;
  statusMessage: string | null;
  currentPhase: string | null;
  currentItemTitle: string | null;
  totalItems: number | null;
  processedItems: number;
  failedItems: number;
  skippedFiles: number;
  artifactSizeBytes: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type BackupRunItem = {
  id: string;
  objectId: string;
  objectType: NotionObjectType;
  title: string;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
  errorMessage: string | null;
  artifactPath: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type BackupRunDetail = BackupRunSummary & {
  artifactDir: string | null;
  manifestAvailable: boolean;
  archiveAvailable: boolean;
  items: BackupRunItem[];
  planSnapshot: Record<string, unknown> | null;
};

export type RestoreStatus = "running" | "succeeded" | "partial_failed" | "failed" | "canceled";

export type RestoreWarning = {
  code: string;
  message: string;
  objectId?: string;
  blockId?: string;
  details?: unknown;
};

export type RestoreItemResult = {
  objectId: string;
  objectType: NotionObjectType;
  title: string;
  status: "succeeded" | "failed" | "skipped";
  newPageId?: string;
  warnings: RestoreWarning[];
  error?: string;
};

export type RestoreReport = {
  restoreId: string;
  sourceRunId: string;
  sourceRunKey: string;
  targetParentId: string;
  status: RestoreStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: {
    createdPages: number;
    createdBlocks: number;
    skippedItems: number;
    failedItems: number;
    warningCount: number;
  };
  mappings: {
    pages: Record<string, string>;
    blocks: Record<string, string>;
    dataSources: Record<string, string>;
    files: Record<string, string>;
  };
  items: RestoreItemResult[];
  warnings: RestoreWarning[];
  errors: string[];
  manifestPath: string | null;
};

export type DashboardOverview = {
  notion: NotionConnectionStatus;
  planCount: number;
  enabledScheduleCount: number;
  latestRun: BackupRunSummary | null;
  runningRuns: BackupRunSummary[];
  backupStorageBytes: number;
};

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

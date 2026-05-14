import type {
  BackupPlan,
  BackupRunDetail,
  BackupRunSummary,
  DashboardOverview,
  DiscoveredContent,
  EncryptionKeyInfo,
  NotionConnectionStatus,
  PageResult,
  SessionResponse,
  SetupStatus
} from "../shared/types";

type RequestOptions = {
  method?: string;
  body?: unknown;
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message || `请求失败：${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const endpoints = {
  setupStatus: () => api<SetupStatus>("/api/setup/status"),
  setupAdmin: (body: { username: string; password: string }) => api<{ user: unknown }>("/api/setup/admin", { method: "POST", body }),
  setupKey: () => api<EncryptionKeyInfo>("/api/setup/key"),
  ackKey: () => api<{ ok: boolean }>("/api/setup/key/ack", { method: "POST" }),
  session: () => api<SessionResponse>("/api/session"),
  login: (body: { username: string; password: string }) => api<{ user: unknown }>("/api/auth/login", { method: "POST", body }),
  logout: () => api<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  changePassword: (body: { currentPassword: string; nextPassword: string }) =>
    api<{ ok: boolean }>("/api/auth/password", { method: "POST", body }),
  dashboard: () => api<DashboardOverview>("/api/dashboard"),
  notionConnection: () => api<NotionConnectionStatus>("/api/notion/connection"),
  saveToken: (token: string) => api<NotionConnectionStatus>("/api/notion/connection", { method: "POST", body: { token } }),
  clearToken: () => api<{ ok: boolean }>("/api/notion/connection", { method: "DELETE" }),
  refreshContent: () => api<{ total: number; lastRefreshedAt: string }>("/api/notion/refresh", { method: "POST" }),
  discovered: (params: URLSearchParams) => api<PageResult<DiscoveredContent> & { lastRefreshedAt: string | null }>(`/api/notion/discovered?${params}`),
  manualAdd: (input: string) => api<DiscoveredContent>("/api/notion/manual-add", { method: "POST", body: { input } }),
  plans: (params = new URLSearchParams()) => api<BackupPlan[]>(`/api/plans?${params}`),
  createPlan: (body: PlanPayload) => api<{ plan: BackupPlan; warnings: string[] }>("/api/plans", { method: "POST", body }),
  updatePlan: (id: string, body: PlanPayload) => api<{ plan: BackupPlan; warnings: string[] }>(`/api/plans/${id}`, { method: "PUT", body }),
  deletePlan: (id: string) => api<{ ok: boolean }>(`/api/plans/${id}`, { method: "DELETE" }),
  runPlan: (id: string) => api<BackupRunSummary>(`/api/plans/${id}/run`, { method: "POST" }),
  runs: (params: URLSearchParams) => api<PageResult<BackupRunSummary>>(`/api/runs?${params}`),
  runDetail: (id: string) => api<BackupRunDetail>(`/api/runs/${id}`),
  cancelRun: (id: string) => api<BackupRunSummary>(`/api/runs/${id}/cancel`, { method: "POST" }),
  deleteRun: (id: string) => api<{ ok: boolean }>(`/api/runs/${id}`, { method: "DELETE" })
};

export type PlanPayload = {
  name: string;
  selectedContent: Array<{ objectId: string; objectType: "page" | "data_source"; title: string }>;
  scheduleEnabled: boolean;
  schedulePreset: "hourly" | "daily" | "weekly" | "monthly" | "custom";
  cronExpression: string | null;
  timezone: string;
  includeComments: boolean;
  includeChildPages: boolean;
  downloadNotionFiles: boolean;
  mirrorExternalFiles: boolean;
  fileSizeLimitBytes: number | null;
};

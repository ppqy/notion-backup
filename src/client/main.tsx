import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarClock,
  CheckCircle2,
  Database,
  Download,
  FileArchive,
  History,
  Home,
  KeyRound,
  Loader2,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Shield,
  Square,
  Trash2,
  XCircle
} from "lucide-react";
import { ADMIN_USERNAME_MIN_LENGTH, NOTION_TOKEN_PREFIX, PASSWORD_MIN_LENGTH } from "../shared/constants";
import type { BackupPlan, BackupRunDetail, BackupRunStatus, DiscoveredContent, NotionConnectionStatus, RestoreReport, SelectedContent } from "../shared/types";
import { endpoints, type PlanPayload } from "./api";
import "./styles.css";

type View = "dashboard" | "notion" | "plans" | "history" | "security";

const defaultPlan: PlanPayload = {
  name: "",
  selectedContent: [],
  scheduleEnabled: false,
  schedulePreset: "daily",
  cronExpression: null,
  timezone: "Asia/Shanghai",
  includeComments: false,
  includeChildPages: true,
  downloadNotionFiles: true,
  mirrorExternalFiles: false,
  fileSizeLimitBytes: 100 * 1024 * 1024
};

function App() {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  const refreshSession = async () => {
    const session = await endpoints.session();
    setNeedsSetup(session.needsSetup);
    setLoggedIn(Boolean(session.user));
    setLoading(false);
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  if (loading) {
    return <FullPageLoading />;
  }
  if (needsSetup) {
    return <SetupFlow onDone={refreshSession} />;
  }
  if (!loggedIn) {
    return <LoginPage onDone={refreshSession} />;
  }
  return <Shell onLogout={refreshSession} />;
}

function FullPageLoading() {
  return (
    <main className="center-screen">
      <Loader2 className="spin" />
    </main>
  );
}

function LoginPage({ onDone }: { onDone: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      await endpoints.login({ username, password });
      await onDone();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="center-screen">
      <form className="auth-panel" onSubmit={submit}>
        <div className="brand-row">
          <Shield />
          <div>
            <h1>Notion 备份</h1>
            <p>管理员登录</p>
          </div>
        </div>
        <label>
          用户名
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
        </label>
        <label>
          密码
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
        </label>
        {message ? <p className="message error">{message}</p> : null}
        <button className="primary" type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="spin" /> : <KeyRound />}
          登录
        </button>
      </form>
    </main>
  );
}

function SetupFlow({ onDone }: { onDone: () => Promise<void> }) {
  const [step, setStep] = useState<"admin" | "key" | "token" | "plan">("admin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [keySource, setKeySource] = useState<"env" | "generated">("generated");
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [message, setMessage] = useState("");
  const [keyCopyMessage, setKeyCopyMessage] = useState("");
  const keyCopyMessageTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (keyCopyMessageTimer.current !== null) {
        window.clearTimeout(keyCopyMessageTimer.current);
      }
    };
  }, []);

  async function createFirstAdmin(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const validationMessage = validateAdminForm(username, password);
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    try {
      await endpoints.setupAdmin({ username, password });
      const key = await endpoints.setupKey();
      setKeyValue(key.value || "");
      setKeySource(key.source);
      setKeyCopyMessage("");
      setStep("key");
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(keyValue);
      showKeyCopyMessage("已复制");
    } catch {
      showKeyCopyMessage("复制失败，请手动复制");
    }
  }

  function showKeyCopyMessage(nextMessage: string) {
    if (keyCopyMessageTimer.current !== null) {
      window.clearTimeout(keyCopyMessageTimer.current);
    }
    setKeyCopyMessage(nextMessage);
    keyCopyMessageTimer.current = window.setTimeout(() => {
      setKeyCopyMessage("");
      keyCopyMessageTimer.current = null;
    }, 3000);
  }

  async function acknowledgeKey() {
    await endpoints.ackKey();
    setStep("token");
  }

  return (
    <main className="setup-shell">
      <section className="setup-steps">
        <span className={step === "admin" ? "active" : ""}>1 管理员</span>
        <span className={step === "key" ? "active" : ""}>2 安全密钥</span>
        <span className={step === "token" ? "active" : ""}>3 Notion</span>
        <span className={step === "plan" ? "active" : ""}>4 备份计划</span>
      </section>

      {step === "admin" ? (
        <form className="setup-panel" onSubmit={createFirstAdmin}>
          <h1>初始化管理员</h1>
          <label>
            用户名
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
          </label>
          <label>
            密码
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
          </label>
          {message ? <p className="message error">{message}</p> : null}
          <button className="primary" type="submit">
            <Shield />
            创建管理员
          </button>
        </form>
      ) : null}

      {step === "key" ? (
        <section className="setup-panel">
          <h1>保存安全密钥</h1>
          {keySource === "generated" && keyValue ? (
            <>
              <p className="message info">系统已生成用于加密 Notion token 的密钥。请保存；丢失后需要重新输入 Notion token。</p>
              <code className="secret">{keyValue}</code>
              <div className="button-status-row">
                <button className="secondary" type="button" onClick={() => void copyKey()}>
                  复制密钥
                </button>
                {keyCopyMessage ? <span className={keyCopyMessage.includes("已") ? "inline-status success" : "inline-status error"}>{keyCopyMessage}</span> : null}
              </div>
            </>
          ) : (
            <p className="message info">已通过环境变量配置加密密钥。</p>
          )}
          <button className="primary" type="button" onClick={acknowledgeKey}>
            <CheckCircle2 />
            已了解
          </button>
        </section>
      ) : null}

      {step === "token" ? (
        <section className="setup-panel">
          <NotionTokenForm
            onSaved={() => {
              setTokenConfigured(true);
              setStep("plan");
            }}
          />
          <button className="ghost" type="button" onClick={() => void onDone()}>
            跳过并进入面板
          </button>
        </section>
      ) : null}

      {step === "plan" && tokenConfigured ? (
        <section className="setup-panel wide">
          <PlanEditor
            initial={defaultPlan}
            submitLabel="创建计划"
            onSubmit={async (payload) => {
              await endpoints.createPlan(payload);
              await onDone();
            }}
          />
          <button className="ghost" type="button" onClick={() => void onDone()}>
            稍后创建
          </button>
        </section>
      ) : null}
    </main>
  );
}

function Shell({ onLogout }: { onLogout: () => Promise<void> }) {
  const [view, setView] = useState<View>("dashboard");

  async function logout() {
    await endpoints.logout();
    await onLogout();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Database />
          <strong>Notion 备份</strong>
        </div>
        <nav>
          <NavButton icon={<Home />} label="概览" active={view === "dashboard"} onClick={() => setView("dashboard")} />
          <NavButton icon={<KeyRound />} label="Notion" active={view === "notion"} onClick={() => setView("notion")} />
          <NavButton icon={<CalendarClock />} label="计划" active={view === "plans"} onClick={() => setView("plans")} />
          <NavButton icon={<History />} label="历史" active={view === "history"} onClick={() => setView("history")} />
          <NavButton icon={<Settings />} label="安全" active={view === "security"} onClick={() => setView("security")} />
        </nav>
        <button className="nav-button" type="button" onClick={logout}>
          <LogOut />
          退出
        </button>
      </aside>
      <main className="content">
        {view === "dashboard" ? <DashboardView go={setView} /> : null}
        {view === "notion" ? <NotionView /> : null}
        {view === "plans" ? <PlansView /> : null}
        {view === "history" ? <HistoryView /> : null}
        {view === "security" ? <SecurityView /> : null}
      </main>
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} type="button" onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function DashboardView({ go }: { go: (view: View) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof endpoints.dashboard>> | null>(null);
  useEffect(() => {
    const load = () => endpoints.dashboard().then(setData);
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);
  if (!data) return <PanelLoading />;

  return (
    <section>
      <PageHeader title="概览" />
      <div className="metrics">
        <Metric label="Notion" value={data.notion.configured ? "已连接" : "未连接"} />
        <Metric label="备份计划" value={String(data.planCount)} />
        <Metric label="定时开启" value={String(data.enabledScheduleCount)} />
        <Metric label="备份占用" value={formatBytes(data.backupStorageBytes)} />
      </div>
      {!data.notion.configured ? (
        <div className="empty-band">
          <p>尚未连接 Notion。</p>
          <button className="primary" type="button" onClick={() => go("notion")}>
            <KeyRound />
            设置 Notion token
          </button>
        </div>
      ) : null}
      <section className="section">
        <div className="section-header">
          <h2>最近备份</h2>
          <button className="secondary" type="button" onClick={() => go("history")}>
            查看历史
          </button>
        </div>
        {data.latestRun ? <RunRow run={data.latestRun} /> : <p className="muted">暂无备份记录</p>}
      </section>
      <section className="section">
        <div className="section-header">
          <h2>运行中</h2>
          <button className="secondary" type="button" onClick={() => go("plans")}>
            新建计划
          </button>
        </div>
        {data.runningRuns.length > 0 ? data.runningRuns.map((run) => <RunRow key={run.id} run={run} />) : <p className="muted">当前没有运行中的备份</p>}
      </section>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NotionView() {
  const [connection, setConnection] = useState<NotionConnectionStatus | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = async () => setConnection(await endpoints.notionConnection());
  useEffect(() => {
    void refresh();
  }, [reloadKey]);

  return (
    <section>
      <PageHeader title="Notion 设置" />
      <section className="section">
        <h2>连接状态</h2>
        {connection ? (
          <div className="status-line">
            <StatusBadge status={connection.configured ? "succeeded" : "failed"} />
            <span>{connection.configured ? "已连接" : "未连接"}</span>
            {connection.validatedAt ? <span className="muted">验证时间：{formatDate(connection.validatedAt)}</span> : null}
          </div>
        ) : (
          <PanelLoading />
        )}
        <NotionTokenForm onSaved={() => setReloadKey((value) => value + 1)} />
        {connection?.configured ? (
          <button
            className="danger"
            type="button"
            onClick={async () => {
              if (confirm("清除 Notion token？发现缓存会一起清空。")) {
                await endpoints.clearToken();
                setReloadKey((value) => value + 1);
              }
            }}
          >
            <Trash2 />
            清除 token
          </button>
        ) : null}
      </section>
      <DiscoveryPanel />
    </section>
  );
}

function NotionTokenForm({ onSaved }: { onSaved: () => void }) {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const normalizedToken = token.trim();
    if (!normalizedToken.startsWith(NOTION_TOKEN_PREFIX)) {
      setMessage(`Notion token 必须以 ${NOTION_TOKEN_PREFIX} 开头`);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await endpoints.saveToken(normalizedToken);
      setToken("");
      setMessage("Notion token 已验证并保存");
      onSaved();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="inline-form" onSubmit={save}>
      <input value={token} onChange={(event) => setToken(event.target.value)} placeholder={`${NOTION_TOKEN_PREFIX}...`} type="password" />
      <button className="primary" type="submit" disabled={busy}>
        {busy ? <Loader2 className="spin" /> : <Save />}
        保存并验证
      </button>
      {message ? <span className={message.includes("已") ? "message success" : "message error"}>{message}</span> : null}
    </form>
  );
}

function DiscoveryPanel({ selectable, selected, onToggle }: { selectable?: boolean; selected?: SelectedContent[]; onToggle?: (item: SelectedContent) => void }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [data, setData] = useState<DiscoveredContent[]>([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [manual, setManual] = useState("");

  const load = async () => {
    const params = new URLSearchParams({ page: "1", pageSize: "100" });
    if (q) params.set("q", q);
    if (type) params.set("type", type);
    const result = await endpoints.discovered(params);
    setData(result.items);
    setLastRefreshedAt(result.lastRefreshedAt);
  };

  useEffect(() => {
    void load().catch(() => undefined);
  }, [q, type]);

  async function refresh() {
    setMessage("");
    try {
      await endpoints.refreshContent();
      await load();
      setMessage("已刷新");
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function addManual(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      await endpoints.manualAdd(manual);
      setManual("");
      await load();
      setMessage("已添加");
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  return (
    <section className="section">
      <div className="section-header">
        <h2>可备份内容</h2>
        <button className="secondary" type="button" onClick={refresh}>
          <RefreshCw />
          刷新
        </button>
      </div>
      <div className="toolbar">
        <label className="search-box">
          <Search />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="搜索标题" />
        </label>
        <select value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">全部类型</option>
          <option value="page">页面</option>
          <option value="data_source">数据源</option>
        </select>
      </div>
      <form className="inline-form" onSubmit={addManual}>
        <input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="粘贴 Notion URL 或 ID" />
        <button className="secondary" type="submit">
          <Plus />
          手动添加
        </button>
      </form>
      {lastRefreshedAt ? <p className="muted">上次刷新：{formatDate(lastRefreshedAt)}</p> : null}
      {message ? <p className={message.includes("已") ? "message success" : "message error"}>{message}</p> : null}
      <div className="table">
        {data.map((item) => {
          const checked = selected?.some((content) => content.objectId === item.objectId) ?? false;
          return (
            <div className={`table-row ${selectable ? "" : "without-selector"}`} key={item.objectId}>
              {selectable ? (
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle?.({ objectId: item.objectId, objectType: item.objectType, title: item.title })}
                />
              ) : null}
              <div>
                <strong>{item.title}</strong>
                <p className="muted">{item.objectType === "page" ? "页面" : "数据源"} · {item.lastEditedTime ? formatDate(item.lastEditedTime) : "无编辑时间"}</p>
              </div>
              <span className="muted source">{item.source === "manual" ? "来源：手动添加" : "来源：自动发现"}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PlansView() {
  const [plans, setPlans] = useState<BackupPlan[]>([]);
  const [editing, setEditing] = useState<BackupPlan | null | "new">(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const load = async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    setPlans(await endpoints.plans(params));
  };
  useEffect(() => {
    void load();
  }, [q, status]);

  return (
    <section>
      <PageHeader
        title="备份计划"
        action={
          <button className="primary" type="button" onClick={() => setEditing("new")}>
            <Plus />
            新建计划
          </button>
        }
      />
      <div className="toolbar">
        <label className="search-box">
          <Search />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="搜索计划名" />
        </label>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="incomplete">未配置完整</option>
          <option value="schedule_enabled">定时已开启</option>
          <option value="schedule_disabled">定时已关闭</option>
        </select>
      </div>
      <div className="plan-list">
        {plans.map((plan) => (
          <article className="plan-row" key={plan.id}>
            <div>
              <h2>{plan.name}</h2>
              <p className="muted">
                {plan.selectedContent.length} 个对象 · {plan.scheduleEnabled ? `下次 ${plan.nextRunAt ? formatDate(plan.nextRunAt) : "待计算"}` : "定时关闭"}
              </p>
            </div>
            <StatusText status={plan.status} />
            <div className="row-actions">
              <button className="secondary" type="button" onClick={() => setEditing(plan)}>
                编辑
              </button>
              <button
                className="secondary"
                type="button"
                onClick={async () => {
                  await endpoints.runPlan(plan.id);
                  await load();
                  alert("备份已排队");
                }}
              >
                <Play />
                手动备份
              </button>
              <button
                className="danger"
                type="button"
                onClick={async () => {
                  if (confirm("删除这个备份计划？历史记录不会删除。")) {
                    await endpoints.deletePlan(plan.id);
                    await load();
                  }
                }}
              >
                <Trash2 />
              </button>
            </div>
          </article>
        ))}
      </div>
      {editing ? (
        <div className="drawer" onClick={() => setEditing(null)}>
          <div className="drawer-panel" onClick={(event) => event.stopPropagation()}>
            <PlanEditor
              initial={editing === "new" ? defaultPlan : planToPayload(editing)}
              submitLabel={editing === "new" ? "创建计划" : "保存计划"}
              onSubmit={async (payload) => {
                const result = editing === "new" ? await endpoints.createPlan(payload) : await endpoints.updatePlan(editing.id, payload);
                if (result.warnings.length > 0) {
                  alert(result.warnings.join("\n"));
                }
                setEditing(null);
                await load();
              }}
            />
            <button className="ghost" type="button" onClick={() => setEditing(null)}>
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PlanEditor({ initial, submitLabel, onSubmit }: { initial: PlanPayload; submitLabel: string; onSubmit: (payload: PlanPayload) => Promise<void> }) {
  const [form, setForm] = useState<PlanPayload>(initial);
  const [message, setMessage] = useState("");
  const selected = form.selectedContent;

  function toggleSelected(item: SelectedContent) {
    setForm((current) => {
      const exists = current.selectedContent.some((content) => content.objectId === item.objectId);
      return {
        ...current,
        selectedContent: exists ? current.selectedContent.filter((content) => content.objectId !== item.objectId) : [...current.selectedContent, item]
      };
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      await onSubmit(form);
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  return (
    <form className="plan-editor" onSubmit={submit}>
      <h2>{submitLabel}</h2>
      <label>
        名称
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      </label>
      <div className="two-col">
        <label className="check-line">
          <input type="checkbox" checked={form.scheduleEnabled} onChange={(event) => setForm({ ...form, scheduleEnabled: event.target.checked })} />
          启用定时备份
        </label>
        <label>
          时区
          <input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
        </label>
      </div>
      <div className="two-col">
        <label>
          频率
          <select value={form.schedulePreset} onChange={(event) => setForm({ ...form, schedulePreset: event.target.value as PlanPayload["schedulePreset"] })}>
            <option value="hourly">每小时</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
            <option value="custom">高级 cron</option>
          </select>
        </label>
        <label>
          Cron
          <input
            value={form.cronExpression || ""}
            onChange={(event) => setForm({ ...form, cronExpression: event.target.value || null })}
            disabled={form.schedulePreset !== "custom"}
          />
        </label>
      </div>
      <div className="options-grid">
        <label className="check-line">
          <input type="checkbox" checked={form.includeChildPages} onChange={(event) => setForm({ ...form, includeChildPages: event.target.checked })} />
          包含子页面
        </label>
        <label className="check-line">
          <input type="checkbox" checked={form.includeComments} onChange={(event) => setForm({ ...form, includeComments: event.target.checked })} />
          备份评论
        </label>
        <label className="check-line">
          <input type="checkbox" checked={form.downloadNotionFiles} onChange={(event) => setForm({ ...form, downloadNotionFiles: event.target.checked })} />
          下载 Notion 文件
        </label>
        <label className="check-line">
          <input type="checkbox" checked={form.mirrorExternalFiles} onChange={(event) => setForm({ ...form, mirrorExternalFiles: event.target.checked })} />
          镜像外链文件
        </label>
      </div>
      <label>
        单文件下载限制 MB
        <input
          type="number"
          min="1"
          value={form.fileSizeLimitBytes ? Math.round(form.fileSizeLimitBytes / 1024 / 1024) : ""}
          onChange={(event) =>
            setForm({
              ...form,
              fileSizeLimitBytes: event.target.value ? Number(event.target.value) * 1024 * 1024 : null
            })
          }
        />
      </label>
      <p className="muted">超过限制的文件会跳过下载，并写入备份结果。</p>
      <DiscoveryPanel selectable selected={selected} onToggle={toggleSelected} />
      {message ? <p className="message error">{message}</p> : null}
      <button className="primary" type="submit">
        <Save />
        {submitLabel}
      </button>
    </form>
  );
}

function HistoryView() {
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof endpoints.runs>> | null>(null);
  const [detail, setDetail] = useState<BackupRunDetail | null>(null);
  const [filters, setFilters] = useState({ q: "", status: "", triggerType: "", page: 1 });

  const load = async () => {
    const params = new URLSearchParams({ page: String(filters.page), pageSize: "20" });
    if (filters.q) params.set("q", filters.q);
    if (filters.status) params.set("status", filters.status);
    if (filters.triggerType) params.set("triggerType", filters.triggerType);
    setRuns(await endpoints.runs(params));
  };

  useEffect(() => {
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [filters]);

  return (
    <section>
      <PageHeader title="备份历史" />
      <div className="toolbar">
        <label className="search-box">
          <Search />
          <input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value, page: 1 })} placeholder="搜索计划名" />
        </label>
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value, page: 1 })}>
          <option value="">全部状态</option>
          <option value="queued">排队中</option>
          <option value="running">运行中</option>
          <option value="cancel_requested">取消中</option>
          <option value="succeeded">成功</option>
          <option value="partial_failed">部分失败</option>
          <option value="failed">失败</option>
          <option value="canceled">已取消</option>
        </select>
        <select value={filters.triggerType} onChange={(event) => setFilters({ ...filters, triggerType: event.target.value, page: 1 })}>
          <option value="">全部触发</option>
          <option value="manual">手动</option>
          <option value="scheduled">定时</option>
        </select>
      </div>
      <div className="run-list">
        {runs?.items.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            onClick={async () => setDetail(await endpoints.runDetail(run.id))}
            actions={
              <>
                {["queued", "running", "cancel_requested"].includes(run.status) ? (
                  <button className="secondary" type="button" onClick={() => void endpoints.cancelRun(run.id).then(load)}>
                    <Square />
                    取消
                  </button>
                ) : (
                  <button
                    className="danger"
                    type="button"
                    onClick={() => {
                      if (confirm("永久删除这次备份及文件？")) {
                        void endpoints.deleteRun(run.id).then(load);
                      }
                    }}
                  >
                    <Trash2 />
                  </button>
                )}
              </>
            }
          />
        ))}
      </div>
      {detail ? <RunDetail detail={detail} onClose={() => setDetail(null)} /> : null}
    </section>
  );
}

function RunDetail({ detail, onClose }: { detail: BackupRunDetail; onClose: () => void }) {
  return (
    <div className="drawer" onClick={onClose}>
      <section className="drawer-panel" onClick={(event) => event.stopPropagation()}>
        <div className="section-header">
          <h2>{detail.planName}</h2>
          <button className="ghost" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="status-line">
          <StatusBadge status={detail.status} />
          <span>{statusLabel(detail.status)}</span>
          <span className="muted">{detail.runKey}</span>
        </div>
        <div className="download-row">
          {detail.manifestAvailable ? (
            <a className="button-like secondary" href={`/api/runs/${detail.id}/manifest`}>
              <Download />
              manifest
            </a>
          ) : null}
          {detail.artifactDir ? (
            <a className="button-like primary" href={`/api/runs/${detail.id}/archive`}>
              <FileArchive />
              下载 zip
            </a>
          ) : null}
        </div>
        <RestorePanel detail={detail} />
        <div className="table">
          {detail.items.map((item) => (
            <div className="table-row" key={item.id}>
              <StatusBadge status={item.status === "succeeded" ? "succeeded" : item.status === "failed" ? "failed" : "running"} />
              <div>
                <strong>{item.title}</strong>
                <p className="muted">{item.objectType === "page" ? "页面" : "数据源"} · {item.artifactPath || item.errorMessage || "处理中"}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function RestorePanel({ detail }: { detail: BackupRunDetail }) {
  const [targetParent, setTargetParent] = useState("");
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const canRestore = Boolean(detail.artifactDir && detail.manifestAvailable && ["succeeded", "partial_failed"].includes(detail.status));

  async function loadLatest() {
    const result = await endpoints.latestRestore(detail.id);
    setReport(result.report);
  }

  useEffect(() => {
    void loadLatest().catch(() => undefined);
  }, [detail.id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!targetParent.trim()) {
      setMessage("请输入目标父页面 URL 或 ID");
      return;
    }
    if (!confirm("恢复会在目标父页面下创建新的 Notion 页面和数据源，不会覆盖原内容。继续？")) {
      return;
    }
    setBusy(true);
    try {
      const nextReport = await endpoints.restoreRun(detail.id, targetParent.trim());
      setReport(nextReport);
      setTargetParent("");
      setMessage("恢复完成");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="restore-panel">
      <div className="section-header">
        <h2>恢复到 Notion</h2>
        {report ? <span className="muted">最近恢复：{formatDate(report.startedAt)}</span> : null}
      </div>
      <p className="muted">恢复会创建新的 Notion 页面和数据源，不会覆盖或回滚原内容。评论、视图、本地文件和无法映射的关系会记录为警告。</p>
      <form className="inline-form" onSubmit={submit}>
        <input value={targetParent} onChange={(event) => setTargetParent(event.target.value)} placeholder="目标父页面 URL 或 ID" disabled={!canRestore || busy} />
        <button className="primary" type="submit" disabled={!canRestore || busy}>
          {busy ? <Loader2 className="spin" /> : <RotateCcw />}
          开始恢复
        </button>
      </form>
      {!canRestore ? <p className="message info">只有已完成或部分失败、且 manifest 可用的备份记录可以恢复。</p> : null}
      {message ? <p className={message.includes("完成") ? "message success" : "message error"}>{message}</p> : null}
      {report ? <RestoreReportSummary report={report} /> : null}
    </section>
  );
}

function RestoreReportSummary({ report }: { report: RestoreReport }) {
  const warnings = report.warnings.slice(0, 8);
  const errors = report.errors.slice(0, 5);
  return (
    <div className="restore-report">
      <div className="metrics compact">
        <Metric label="状态" value={restoreStatusLabel(report.status)} />
        <Metric label="新建页面" value={String(report.summary.createdPages)} />
        <Metric label="新建数据源" value={String(report.summary.createdDataSources ?? 0)} />
        <Metric label="新建区块" value={String(report.summary.createdBlocks)} />
        <Metric label="警告" value={String(report.summary.warningCount)} />
        <Metric label="失败" value={String(report.summary.failedItems)} />
      </div>
      <p className="muted">目标父页面：{report.targetParentId}</p>
      <div className="table">
        {report.items.map((item) => (
          <div className="table-row" key={`${item.objectId}-${item.status}`}>
            <StatusBadge status={item.status === "succeeded" ? "succeeded" : item.status === "failed" ? "failed" : "canceled"} />
            <div>
              <strong>{item.title}</strong>
              <p className="muted">
                {item.status === "succeeded"
                  ? item.newDataSourceId
                    ? `新数据源：${item.newDataSourceId}`
                    : `新页面：${item.newPageId}`
                  : item.error || item.warnings[0]?.message || "已跳过"}
              </p>
            </div>
          </div>
        ))}
      </div>
      {warnings.length > 0 ? (
        <div className="warning-list">
          <strong>警告</strong>
          {warnings.map((warning, index) => (
            <p className="muted" key={`${warning.code}-${index}`}>
              {warning.message}
            </p>
          ))}
          {report.warnings.length > warnings.length ? <p className="muted">还有 {report.warnings.length - warnings.length} 条警告记录在 restore manifest 中。</p> : null}
        </div>
      ) : null}
      {errors.length > 0 ? (
        <div className="warning-list">
          <strong>错误</strong>
          {errors.map((error, index) => (
            <p className="message error" key={`${error}-${index}`}>
              {error}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SecurityView() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!currentPassword) {
      setMessage("请输入当前密码");
      return;
    }
    if (nextPassword.length < PASSWORD_MIN_LENGTH) {
      setMessage(`新密码至少 ${PASSWORD_MIN_LENGTH} 个字符`);
      return;
    }
    try {
      await endpoints.changePassword({ currentPassword, nextPassword });
      setCurrentPassword("");
      setNextPassword("");
      setMessage("密码已修改，请重新登录");
    } catch (error) {
      setMessage(errorText(error));
    }
  }
  return (
    <section>
      <PageHeader title="安全设置" />
      <form className="section narrow" onSubmit={submit}>
        <label>
          当前密码
          <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label>
          新密码
          <input type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} />
        </label>
        {message ? <p className={message.includes("已") ? "message success" : "message error"}>{message}</p> : null}
        <button className="primary" type="submit">
          <Save />
          修改密码
        </button>
      </form>
    </section>
  );
}

function validateAdminForm(username: string, password: string): string | null {
  if (username.trim().length < ADMIN_USERNAME_MIN_LENGTH) {
    return `用户名至少 ${ADMIN_USERNAME_MIN_LENGTH} 个字符`;
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `密码至少 ${PASSWORD_MIN_LENGTH} 个字符`;
  }
  return null;
}

function PageHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {action}
    </header>
  );
}

function PanelLoading() {
  return (
    <div className="panel-loading">
      <Loader2 className="spin" />
    </div>
  );
}

function RunRow({ run, onClick, actions }: { run: Awaited<ReturnType<typeof endpoints.runs>>["items"][number]; onClick?: () => void; actions?: React.ReactNode }) {
  return (
    <article className={`run-row ${onClick ? "clickable" : ""}`} onClick={onClick}>
      <StatusBadge status={run.status} />
      <div>
        <h2>{run.planName}</h2>
        <p className="muted">
          {run.triggerType === "manual" ? "手动" : "定时"} · {formatDate(run.createdAt)}
          {run.currentPhase ? ` · ${run.currentPhase}` : ""}
        </p>
      </div>
      <div className="progress-text">
        {run.totalItems !== null ? `${run.processedItems}/${run.totalItems}` : run.processedItems}
        {run.failedItems ? ` · 失败 ${run.failedItems}` : ""}
      </div>
      <div className="row-actions" onClick={(event) => event.stopPropagation()}>
        {actions}
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: BackupRunStatus | "failed" | "succeeded" | "running" }) {
  const icon = status === "succeeded" ? <CheckCircle2 /> : status === "failed" || status === "partial_failed" ? <XCircle /> : <Loader2 className="spin" />;
  return <span className={`status-badge ${status}`}>{icon}</span>;
}

function StatusText({ status }: { status: BackupPlan["status"] }) {
  const labels = {
    incomplete: "未配置完整",
    schedule_enabled: "定时已开启",
    schedule_disabled: "定时已关闭"
  };
  return <span className={`pill ${status}`}>{labels[status]}</span>;
}

function statusLabel(status: BackupRunStatus): string {
  const labels: Record<BackupRunStatus, string> = {
    queued: "排队中",
    running: "运行中",
    cancel_requested: "取消中",
    succeeded: "成功",
    partial_failed: "部分失败",
    failed: "失败",
    canceled: "已取消"
  };
  return labels[status];
}

function restoreStatusLabel(status: RestoreReport["status"]): string {
  const labels: Record<RestoreReport["status"], string> = {
    running: "运行中",
    succeeded: "成功",
    partial_failed: "部分失败",
    failed: "失败",
    canceled: "已取消"
  };
  return labels[status];
}

function planToPayload(plan: BackupPlan): PlanPayload {
  return {
    name: plan.name,
    selectedContent: plan.selectedContent,
    scheduleEnabled: plan.scheduleEnabled,
    schedulePreset: plan.schedulePreset,
    cronExpression: plan.cronExpression,
    timezone: plan.timezone,
    includeComments: plan.includeComments,
    includeChildPages: plan.includeChildPages,
    downloadNotionFiles: plan.downloadNotionFiles,
    mirrorExternalFiles: plan.mirrorExternalFiles,
    fileSizeLimitBytes: plan.fileSizeLimitBytes
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

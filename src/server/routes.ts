import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { db } from "./db.js";
import { acknowledgeGeneratedKey, getKeyMaterial } from "./crypto.js";
import { changePassword, createAdmin, getUserBySessionToken, hasAdmin, login, logout, requireUser } from "./auth.js";
import { badRequest, notFound, sendError } from "./errors.js";
import { parseBody, backupPlanInputSchema, changePasswordSchema, createAdminSchema, loginSchema, manualAddSchema, notionTokenSchema } from "./validation.js";
import { clearConnection, getConnectionStatus, getNotionToken, listDiscoveredContent, saveConnection, upsertDiscoveredContent } from "./repositories/notionRepository.js";
import { NotionClient, ensureSupportedObjectType } from "./notionClient.js";
import { normalizeNotionId } from "./notionIds.js";
import { validateObjectAccess } from "./backupWorker.js";
import { createPlan, listPlans, softDeletePlan, updatePlan } from "./repositories/planRepository.js";
import { BackupWorker } from "./backupWorker.js";
import { deleteRun, getLatestRun, getRun, getRunningRuns, listRuns, requestRunCancel, updateRun } from "./repositories/runRepository.js";
import { directorySizeBytes, generateZip } from "./storage.js";

const querySchema = z.object({
  q: z.string().optional(),
  type: z.enum(["page", "data_source"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().default(25),
  status: z.string().optional(),
  triggerType: z.enum(["manual", "scheduled"]).optional(),
  planId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional()
});

export function registerRoutes(app: FastifyInstance, worker: BackupWorker): void {
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    sendError(reply, error);
  });

  app.get("/healthz", async () => {
    db.prepare("SELECT 1").get();
    return {
      ok: true,
      database: "ok",
      time: new Date().toISOString()
    };
  });

  app.get("/api/setup/status", async () => {
    return {
      needsSetup: !hasAdmin(),
      hasAdmin: hasAdmin()
    };
  });

  app.post("/api/setup/admin", async (request, reply) => {
    const input = parseBody(createAdminSchema, request.body);
    const user = createAdmin(input.username, input.password);
    const session = login(input.username, input.password);
    setSessionCookie(reply, session.token, session.expiresAt);
    return { user };
  });

  app.get("/api/setup/key", async (request) => {
    requireUser(request);
    const material = getKeyMaterial();
    return {
      source: material.source,
      value: material.displayValue,
      acknowledged: material.acknowledged
    };
  });

  app.post("/api/setup/key/ack", async (request) => {
    requireUser(request);
    acknowledgeGeneratedKey();
    return { ok: true };
  });

  app.get("/api/session", async (request) => {
    const token = request.cookies[config.sessionCookieName];
    return {
      user: getUserBySessionToken(token),
      needsSetup: !hasAdmin()
    };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const input = parseBody(loginSchema, request.body);
    const session = login(input.username, input.password);
    setSessionCookie(reply, session.token, session.expiresAt);
    return { user: session.user };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    logout(request.cookies[config.sessionCookieName]);
    reply.clearCookie(config.sessionCookieName, cookieOptions());
    return { ok: true };
  });

  app.post("/api/auth/password", async (request) => {
    const user = requireUser(request);
    const input = parseBody(changePasswordSchema, request.body);
    changePassword(user.id, input.currentPassword, input.nextPassword);
    return { ok: true };
  });

  app.get("/api/dashboard", async (request) => {
    requireUser(request);
    return {
      notion: getConnectionStatus(),
      planCount: listPlans({}).length,
      enabledScheduleCount: listPlans({}).filter((plan) => plan.scheduleEnabled).length,
      latestRun: getLatestRun(),
      runningRuns: getRunningRuns(),
      backupStorageBytes: directorySizeBytes(config.backupRoot)
    };
  });

  app.get("/api/notion/connection", async (request) => {
    requireUser(request);
    return getConnectionStatus();
  });

  app.post("/api/notion/connection", async (request) => {
    requireUser(request);
    const input = parseBody(notionTokenSchema, request.body);
    const notion = new NotionClient(input.token);
    const identity = await notion.validateToken();
    const results = await notion.searchAll();
    saveConnection(input.token, identity);
    upsertDiscoveredContent(results.filter((item) => item.object === "page" || item.object === "data_source" || item.object === "database"), "search");
    return getConnectionStatus();
  });

  app.delete("/api/notion/connection", async (request) => {
    requireUser(request);
    clearConnection();
    return { ok: true };
  });

  app.post("/api/notion/refresh", async (request) => {
    requireUser(request);
    const token = requireNotionToken();
    const notion = new NotionClient(token);
    const results = await notion.searchAll();
    const items = upsertDiscoveredContent(
      results.filter((item) => item.object === "page" || item.object === "data_source" || item.object === "database"),
      "search"
    );
    return {
      items,
      total: items.length,
      lastRefreshedAt: new Date().toISOString()
    };
  });

  app.get("/api/notion/discovered", async (request) => {
    requireUser(request);
    const query = querySchema.parse(request.query);
    const pageSize = Math.min(100, query.pageSize);
    const result = listDiscoveredContent({
      q: query.q,
      type: query.type,
      limit: pageSize,
      offset: (query.page - 1) * pageSize
    });
    return {
      items: result.items,
      page: query.page,
      pageSize,
      total: result.total,
      lastRefreshedAt: result.lastRefreshedAt
    };
  });

  app.post("/api/notion/manual-add", async (request) => {
    requireUser(request);
    const input = parseBody(manualAddSchema, request.body);
    const objectId = normalizeNotionId(input.input);
    const token = requireNotionToken();
    const notion = new NotionClient(token);
    const { object } = await validateObjectAccess(notion, objectId);
    ensureSupportedObjectType(object);
    const [content] = upsertDiscoveredContent([object], "manual");
    return content;
  });

  app.get("/api/plans", async (request) => {
    requireUser(request);
    const query = querySchema.parse(request.query);
    return listPlans({
      q: query.q,
      status: query.status as never
    });
  });

  app.post("/api/plans", async (request) => {
    requireUser(request);
    const input = parseBody(backupPlanInputSchema, request.body);
    return createPlan(input);
  });

  app.get("/api/plans/:id", async (request) => {
    requireUser(request);
    return getPlanFromRequest(request);
  });

  app.put("/api/plans/:id", async (request) => {
    requireUser(request);
    const input = parseBody(backupPlanInputSchema, request.body);
    return updatePlan(getParam(request, "id"), input);
  });

  app.delete("/api/plans/:id", async (request) => {
    requireUser(request);
    softDeletePlan(getParam(request, "id"));
    return { ok: true };
  });

  app.post("/api/plans/:id/run", async (request) => {
    requireUser(request);
    return worker.enqueueManualRun(getParam(request, "id"));
  });

  app.get("/api/runs", async (request) => {
    requireUser(request);
    const query = querySchema.parse(request.query);
    return listRuns({
      page: query.page,
      pageSize: query.pageSize,
      planId: query.planId,
      status: query.status as never,
      triggerType: query.triggerType,
      q: query.q,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo
    });
  });

  app.get("/api/runs/:id", async (request) => {
    requireUser(request);
    return getRun(getParam(request, "id"));
  });

  app.post("/api/runs/:id/cancel", async (request) => {
    requireUser(request);
    return requestRunCancel(getParam(request, "id"));
  });

  app.delete("/api/runs/:id", async (request) => {
    requireUser(request);
    deleteRun(getParam(request, "id"));
    return { ok: true };
  });

  app.get("/api/runs/:id/manifest", async (request, reply) => {
    requireUser(request);
    const run = getRun(getParam(request, "id"));
    if (!run.artifactDir) {
      throw notFound("manifest 不存在");
    }
    const manifest = path.join(run.artifactDir, "manifest.json");
    if (!existsSync(manifest)) {
      throw notFound("manifest 不存在");
    }
    return streamFile(reply, manifest, `${run.runKey}_manifest.json`, "application/json");
  });

  app.get("/api/runs/:id/archive", async (request, reply) => {
    requireUser(request);
    const run = getRun(getParam(request, "id"));
    if (!run.artifactDir || !existsSync(run.artifactDir)) {
      throw notFound("备份文件不存在");
    }
    const archivePath = await generateZip(run.artifactDir);
    updateRun(run.id, { archive_path: archivePath });
    return streamFile(reply, archivePath, `${run.runKey}.zip`, "application/zip");
  });
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string): void {
  reply.setCookie(config.sessionCookieName, token, {
    ...cookieOptions(),
    expires: new Date(expiresAt)
  });
}

function cookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.sessionSecure
  };
}

function requireNotionToken(): string {
  const token = getNotionToken();
  if (!token) {
    throw badRequest("请先设置有效的 Notion token");
  }
  return token;
}

function getParam(request: FastifyRequest, key: string): string {
  const params = request.params as Record<string, string>;
  return params[key];
}

function getPlanFromRequest(request: FastifyRequest) {
  const id = getParam(request, "id");
  const plan = listPlans({}).find((item) => item.id === id);
  if (!plan) {
    throw notFound("备份计划不存在");
  }
  return plan;
}

function streamFile(reply: FastifyReply, filePath: string, fileName: string, contentType: string) {
  reply.header("content-type", contentType);
  reply.header("content-disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
  return reply.send(createReadStream(filePath));
}

import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { closeDb, migrate } from "./db.js";
import { registerRoutes } from "./routes.js";
import { BackupWorker } from "./backupWorker.js";
import { RestoreWorker } from "./restoreWorker.js";

async function main(): Promise<void> {
  migrate();
  const app = Fastify({
    logger: true
  });
  await app.register(cookie);

  const worker = new BackupWorker();
  const restoreWorker = new RestoreWorker();
  registerRoutes(app, worker);

  const clientDir = path.resolve(process.cwd(), "dist/client");
  await app.register(fastifyStatic, {
    root: clientDir,
    prefix: "/",
    wildcard: false
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api") || request.url.startsWith("/healthz")) {
      void reply.status(404).send({
        error: {
          code: "not_found",
          message: "资源不存在"
        }
      });
      return;
    }
    void reply.sendFile("index.html");
  });

  worker.start();
  restoreWorker.start();

  const shutdown = async () => {
    worker.stop();
    restoreWorker.stop();
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  await app.listen({
    host: config.host,
    port: config.port
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

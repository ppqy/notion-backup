import { mkdirSync } from "node:fs";
import path from "node:path";

export type AppConfig = {
  nodeEnv: string;
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  backupRoot: string;
  appEncryptionKey: string | null;
  sessionCookieName: string;
  sessionSecure: boolean;
};

function readInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
  const databasePath = process.env.DATABASE_PATH || path.join(dataDir, "app.db");
  const backupRoot = process.env.BACKUP_ROOT || path.join(dataDir, "backups");

  mkdirSync(dataDir, { recursive: true });
  mkdirSync(backupRoot, { recursive: true });

  return {
    nodeEnv: process.env.NODE_ENV || "development",
    host: process.env.HOST || "0.0.0.0",
    port: readInt(process.env.PORT, 3000),
    dataDir,
    databasePath,
    backupRoot,
    appEncryptionKey: process.env.APP_ENCRYPTION_KEY || null,
    sessionCookieName: process.env.SESSION_COOKIE_NAME || "notion_backup_session",
    sessionSecure: process.env.SESSION_SECURE === "true"
  };
}

export const config = loadConfig();

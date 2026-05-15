import Database from "better-sqlite3";
import { config } from "./config.js";

export type SqliteDatabase = Database.Database;

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const migrations = [
  {
    id: "001_initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notion_connection (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        encrypted_token TEXT NOT NULL,
        token_mask TEXT NOT NULL,
        identity_json TEXT,
        validated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS discovered_content (
        id TEXT PRIMARY KEY,
        object_id TEXT NOT NULL UNIQUE,
        object_type TEXT NOT NULL,
        title TEXT NOT NULL,
        parent_json TEXT,
        url TEXT,
        last_edited_time TEXT,
        raw_json TEXT NOT NULL,
        source TEXT NOT NULL,
        discovered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS backup_plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        selected_content_json TEXT NOT NULL,
        schedule_enabled INTEGER NOT NULL DEFAULT 0,
        schedule_preset TEXT NOT NULL DEFAULT 'daily',
        cron_expression TEXT,
        timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
        next_run_at TEXT,
        include_comments INTEGER NOT NULL DEFAULT 0,
        include_child_pages INTEGER NOT NULL DEFAULT 1,
        download_notion_files INTEGER NOT NULL DEFAULT 1,
        mirror_external_files INTEGER NOT NULL DEFAULT 0,
        file_size_limit_bytes INTEGER,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_backup_plans_deleted_created ON backup_plans(deleted_at, created_at);
      CREATE INDEX IF NOT EXISTS idx_backup_plans_schedule ON backup_plans(schedule_enabled, next_run_at, deleted_at);

      CREATE TABLE IF NOT EXISTS backup_runs (
        id TEXT PRIMARY KEY,
        run_key TEXT NOT NULL UNIQUE,
        plan_id TEXT REFERENCES backup_plans(id) ON DELETE SET NULL,
        plan_snapshot_json TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        status TEXT NOT NULL,
        status_message TEXT,
        current_phase TEXT,
        current_item_title TEXT,
        total_items INTEGER,
        processed_items INTEGER NOT NULL DEFAULT 0,
        failed_items INTEGER NOT NULL DEFAULT 0,
        skipped_files INTEGER NOT NULL DEFAULT 0,
        artifact_dir TEXT,
        artifact_size_bytes INTEGER,
        archive_path TEXT,
        started_at TEXT,
        finished_at TEXT,
        cancel_requested_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_backup_runs_created ON backup_runs(created_at);
      CREATE INDEX IF NOT EXISTS idx_backup_runs_status ON backup_runs(status);
      CREATE INDEX IF NOT EXISTS idx_backup_runs_plan ON backup_runs(plan_id);

      CREATE TABLE IF NOT EXISTS backup_run_items (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES backup_runs(id) ON DELETE CASCADE,
        object_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        artifact_path TEXT,
        metadata_json TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_backup_run_items_run ON backup_run_items(run_id);
    `
  },
  {
    id: "002_restore_runs",
    sql: `
      CREATE TABLE IF NOT EXISTS restore_runs (
        id TEXT PRIMARY KEY,
        restore_key TEXT NOT NULL UNIQUE,
        source_run_id TEXT NOT NULL REFERENCES backup_runs(id) ON DELETE CASCADE,
        source_run_key TEXT NOT NULL,
        target_parent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        status_message TEXT,
        current_phase TEXT,
        current_item_title TEXT,
        total_items INTEGER NOT NULL DEFAULT 0,
        processed_items INTEGER NOT NULL DEFAULT 0,
        failed_items INTEGER NOT NULL DEFAULT 0,
        skipped_items INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        created_pages INTEGER NOT NULL DEFAULT 0,
        created_data_sources INTEGER NOT NULL DEFAULT 0,
        created_blocks INTEGER NOT NULL DEFAULT 0,
        manifest_path TEXT,
        started_at TEXT,
        finished_at TEXT,
        cancel_requested_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_restore_runs_created ON restore_runs(created_at);
      CREATE INDEX IF NOT EXISTS idx_restore_runs_status ON restore_runs(status);
      CREATE INDEX IF NOT EXISTS idx_restore_runs_source ON restore_runs(source_run_id);

      CREATE TABLE IF NOT EXISTS restore_run_items (
        id TEXT PRIMARY KEY,
        restore_run_id TEXT NOT NULL REFERENCES restore_runs(id) ON DELETE CASCADE,
        object_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        new_page_id TEXT,
        new_data_source_id TEXT,
        warning_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_restore_run_items_restore ON restore_run_items(restore_run_id);
    `
  },
  {
    id: "003_restore_model_evolution_fields",
    sql: `
      ALTER TABLE restore_runs ADD COLUMN options_json TEXT;
      ALTER TABLE restore_runs ADD COLUMN summary_json TEXT;
    `
  }
] as const;

export function migrate(): void {
  applyMigrations(db);
}

export function applyMigrations(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const exists = database.prepare("SELECT 1 FROM migrations WHERE id = ?").pluck();
  const insert = database.prepare("INSERT INTO migrations (id, applied_at) VALUES (?, ?)");
  const apply = database.transaction(() => {
    for (const migration of migrations) {
      if (exists.get(migration.id)) {
        continue;
      }
      database.exec(migration.sql);
      insert.run(migration.id, new Date().toISOString());
    }
  });
  apply();
}

export function closeDb(): void {
  db.close();
}

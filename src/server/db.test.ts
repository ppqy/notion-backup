import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./db.js";

describe("database migrations", () => {
  it("adds restore model evolution fields without rewriting existing restore rows", () => {
    const database = new Database(":memory:");
    try {
      database.exec(`
        CREATE TABLE migrations (
          id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
        INSERT INTO migrations (id, applied_at) VALUES ('001_initial_schema', '2026-05-15T00:00:00.000Z');
        INSERT INTO migrations (id, applied_at) VALUES ('002_restore_runs', '2026-05-15T00:00:00.000Z');

        CREATE TABLE restore_runs (
          id TEXT PRIMARY KEY,
          restore_key TEXT NOT NULL UNIQUE,
          source_run_id TEXT NOT NULL,
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
        INSERT INTO restore_runs (
          id, restore_key, source_run_id, source_run_key, target_parent_id, status, total_items, created_at, updated_at
        ) VALUES (
          'restore-1', 'restore-key', 'run-1', 'run-key', 'target-parent', 'queued', 1, '2026-05-15T00:00:00.000Z', '2026-05-15T00:00:00.000Z'
        );
      `);

      applyMigrations(database);

      const row = database.prepare("SELECT id, options_json, summary_json FROM restore_runs WHERE id = ?").get("restore-1") as {
        id: string;
        options_json: string | null;
        summary_json: string | null;
      };
      const columns = database.prepare("PRAGMA table_info(restore_runs)").all() as Array<{ name: string; notnull: 0 | 1 }>;

      expect(row).toEqual({
        id: "restore-1",
        options_json: null,
        summary_json: null
      });
      expect(columns.find((column) => column.name === "options_json")?.notnull).toBe(0);
      expect(columns.find((column) => column.name === "summary_json")?.notnull).toBe(0);
    } finally {
      database.close();
    }
  });
});

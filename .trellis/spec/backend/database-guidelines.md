# Database Guidelines

## Overview

The MVP uses SQLite through `better-sqlite3`. The database stores app metadata, the single admin, sessions, encrypted Notion connection metadata, discovered content cache, backup plans, runs, and run items.

## Migrations

Migrations are embedded in `src/server/db.ts` and tracked in the `migrations` table. Additive schema changes should be appended as new migration objects. Do not edit an already-applied migration after release.

## Naming Conventions

Tables and columns use snake_case. TypeScript DTOs use camelCase. Repository modules convert between them.

## Scenario: SQLite Metadata and Backup History

### 1. Scope / Trigger
- Trigger: Any DB schema, repository, backup history, schedule, or token metadata change.

### 2. Signatures
- `migrate(): void`
- `db: better-sqlite3.Database`
- Core tables: `admins`, `sessions`, `notion_connection`, `discovered_content`, `backup_plans`, `backup_runs`, `backup_run_items`.

### 3. Contracts
- `notion_connection.encrypted_token` must store encrypted text only.
- `backup_plans.selected_content_json` stores `SelectedContent[]`.
- `backup_runs.plan_snapshot_json` stores a point-in-time plan snapshot so history survives soft-deleted plans.
- Artifact files are outside SQLite under `/data/backups/runs/<run-id>/`.

### 4. Validation & Error Matrix
- Missing admin during setup -> setup routes may create the first admin.
- Existing admin during setup -> `409 conflict`.
- Incomplete plan may be saved, but schedule enablement and manual run enforce their own validators.
- Running/queued run delete -> `400 bad_request`; cancel first.

### 5. Good/Base/Bad Cases
- Good: soft-delete backup plans with `deleted_at`; preserve run history.
- Base: clear discovery cache when Notion token changes or is cleared.
- Bad: hard-delete a plan and lose historical plan context.

### 6. Tests Required
- Unit-test validators that determine missing manual/schedule requirements.
- Type-check row-to-DTO mapping after schema changes.
- Integration-test migrations before changing existing tables.

### 7. Wrong vs Correct

#### Wrong
```sql
DELETE FROM backup_plans WHERE id = ?;
```

#### Correct
```sql
UPDATE backup_plans
SET deleted_at = ?, schedule_enabled = 0, next_run_at = NULL
WHERE id = ?;
```

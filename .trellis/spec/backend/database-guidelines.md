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
- `discovered_content.source` distinguishes Notion search discovery from explicit manual additions.
- A full Notion search refresh must reconcile `source = 'search'` rows with the latest search result and remove stale search rows that are no longer returned. Do not prune `source = 'manual'` rows solely because search omits them; remove manual rows only after a direct Notion retrieve confirms the object is inaccessible/deleted.
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
- Base: keep a manually added discovered object visible across search refreshes when direct retrieve still confirms access.
- Bad: hard-delete a plan and lose historical plan context.
- Bad: only upsert latest Notion search results and leave old search-discovered rows visible forever.

### 6. Tests Required
- Unit-test validators that determine missing manual/schedule requirements.
- Type-check row-to-DTO mapping after schema changes.
- Integration-test migrations before changing existing tables.
- Regression-test discovered content search reconciliation: stale search rows removed, manual rows preserved, totals reflect visible rows.

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

## Scenario: Discovered Notion Parent Metadata

### 1. Scope / Trigger
- Trigger: Any change to Notion discovery cache mapping, `DiscoveredContent`, or UI grouping based on Notion parent relationships.

### 2. Signatures
- SQLite column: `discovered_content.parent_json TEXT`
- Shared DTO fields:
  - `DiscoveredContent.parent: string | null` keeps the raw serialized parent object for compatibility/debugging.
  - `DiscoveredContent.parentType: "workspace" | "page" | "data_source" | "database" | "block" | "unknown" | null`
  - `DiscoveredContent.parentId: string | null`

### 3. Contracts
- Repository mapping is responsible for parsing `parent_json`; frontend code must not parse SQLite-shaped data.
- Workspace parents map to `{ parentType: "workspace", parentId: null }`.
- Parent ID objects such as `page_id`, `data_source_id`, `database_id`, and `block_id` map to display-safe parent types and IDs.
- Unknown parent shapes must not fail discovery listing; map them to `parentType: "unknown"` and keep any recognized fallback ID when available.

### 4. Validation & Error Matrix
- Missing `parent_json` -> `parentType: null`, `parentId: null`.
- Invalid JSON in `parent_json` -> `parentType: null`, `parentId: null`.
- Known parent type with non-string ID -> known `parentType`, `parentId: null`.
- Unknown parent type -> `parentType: "unknown"`, best-effort `parentId`.

### 5. Good/Base/Bad Cases
- Good: UI groups child pages/data-source entries using `parentId` from the shared DTO.
- Base: objects whose parent is not in the current discovered result remain visible and selectable.
- Bad: recursively crawl all block children during refresh just to build the settings list hierarchy.
- Bad: parse raw `parent_json` independently in React components.

### 6. Tests Required
- Repository tests for workspace, page, data source/database, block, invalid, and unknown parent shapes when parser behavior changes.
- Frontend tree/grouping tests when display hierarchy behavior changes.
- `npm run lint`, `npm run build`, and `npm test` after changing shared DTO fields.

### 7. Wrong vs Correct

#### Wrong
```tsx
const parent = JSON.parse(item.parent ?? "{}");
```

#### Correct
```tsx
if (item.parentId && discoveredById.has(item.parentId)) {
  // Group under the discovered parent using shared DTO fields.
}
```

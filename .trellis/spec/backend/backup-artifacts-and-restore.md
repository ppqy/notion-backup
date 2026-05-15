# Backup Artifacts and Restore Contracts

## Overview

Backup artifacts are durable filesystem outputs under `BACKUP_ROOT`. JSON artifacts are the canonical backup record. Markdown is a derived human-readable/import helper and must not be treated as the source of truth when JSON is available.

Restore/import is a future best-effort workflow. It can recreate content into new Notion objects, but it cannot preserve original Notion object IDs, edit history, permissions, or every read-only/computed value.

## Scenario: JSON-Canonical Backup Artifacts

### 1. Scope / Trigger

* Trigger: Any change to backup artifact shape, page/data source serialization, asset handling, artifact download, or future restore/import behavior.

### 2. Signatures

* Backup root: `BACKUP_ROOT`, default `${DATA_DIR}/backups`.
* Run directory: `runs/<run-key>/`.
* Run manifest: `manifest.json`.
* Run logs: `logs.jsonl`.
* Page artifact: `pages/<page-id>.json`.
* Data source artifacts: `data-sources/<data-source-id>/schema.json` and `data-sources/<data-source-id>/entries.json`.
* Markdown artifact: `markdown/<page-id>.md`.
* Asset artifact: `assets/<page-id>/manifest.json` plus downloaded files.
* Zip artifact: `archive.zip`, generated on demand from a run directory.

### 3. Contracts

* `manifest.json` records run status, partial state, plan snapshot, selected items, per-item result/error metadata, and skipped file count.
* `pages/<page-id>.json` is canonical and contains the page object, complete property item payloads where available, recursive block JSON, optional comments, and optional Markdown API response.
* `data-sources/<data-source-id>/schema.json` stores the retrieved data source object and schema.
* `data-sources/<data-source-id>/entries.json` stores queried data source entry pages; each entry page must also be backed up through the page artifact path.
* `markdown/<page-id>.md` is derived output for people and low-fidelity manual import only.
* Notion-hosted files have temporary URLs. When the plan enables local file backup, download them during the run and record local paths plus skip/error reasons.
* Item-level backup failures should be recorded without deleting already-written artifacts.

### 4. Validation & Error Matrix

* Missing Notion token before backup -> fail the run with a user-facing token message.
* Missing `manifest.json` in a restore input -> fail restore preflight.
* Missing page/data source JSON for a selected restore item -> fail that item, not unrelated items.
* Missing local asset file during restore -> record an asset warning or item failure according to the restore policy.
* Unsupported block/property type during restore -> skip or degrade explicitly; do not silently fabricate equivalent content.
* Unresolved relation/mention/page reference -> defer to a mapping pass; if still unresolved, leave unset and record a warning.
* Notion insert/read capability failure -> surface the required capability and stop the affected operation.

### 5. Good/Base/Bad Cases

* Good: future restore reads `pages/<page-id>.json`, uploads local assets, appends block JSON, then uses Markdown only for preview or fallback.
* Base: user manually imports files from `markdown/` and the UI labels this as low-fidelity manual import.
* Bad: restore reconstructs pages from Markdown while ignoring available page JSON, property items, block JSON, and asset manifests.

### 6. Tests Required

* Artifact shape changes need unit or integration coverage asserting required files and key manifest fields.
* Asset behavior changes need tests for downloaded, skipped, and external URL cases.
* Future restore code must test old-to-new ID mapping, missing artifact handling, unsupported block warnings, and partial restore reporting.
* View-aware restore code must first add view artifacts to backup output, then test property-ID remapping and unsupported view warnings.
* API route changes around artifact download or restore must pass `npm run lint`, `npm run build`, and targeted Vitest coverage.

### 7. Wrong vs Correct

#### Wrong

```ts
// Markdown import is convenient, but it discards structured backup data.
const body = await readFile(`markdown/${pageId}.md`, "utf8");
await notion.pages.create({ parent, markdown: body });
```

#### Correct

```ts
// Restore should start from the canonical JSON artifact.
const artifact = await readJson<PageArtifact>(`pages/${pageId}.json`);
const restoredPage = await createPageFromProperties(artifact.page, artifact.propertyItems);
await appendBlocksFromJson(restoredPage.id, artifact.blocks);
```

## Design Decision: Restore Is Best-Effort Recreation

**Context**: Notion's API supports creating pages, databases/data sources, block children, and file uploads, but created objects receive new IDs and API coverage does not include every workspace/UI detail.

**Decision**: Treat restore/import as best-effort recreation. The feature must write a restore manifest containing old-to-new ID mappings, warnings, skipped fields, partial failures, and target object IDs.

**Must Not Claim**:

* Original page/block/data source IDs are preserved.
* Original URLs, edit history, permissions, or comments history are restored.
* Read-only/computed values such as formulas, rollups, created time, created by, last edited time, and last edited by can be written back exactly.
* Views from current backup artifacts are restored. Current artifacts do not include Notion view objects; future view-aware backups may restore API-supported view configuration after those objects are backed up, but arbitrary UI state and unsupported view details are still not guaranteed.

**Related Research**:

* `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-research/research/notion-json-backup-and-restore.md`
* `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-options/research/restore-options-to-notion.md`
* `.trellis/tasks/05-15-notion-restore-data-sources-page-properties/research/restore-data-sources-page-properties.md`

## Scenario: Page JSON Restore MVP

### 1. Scope / Trigger

* Trigger: Any change to restore APIs, restore report DTOs, page/block conversion, or restore manifest persistence.

### 2. Signatures

* Start restore: `POST /api/runs/:id/restore`
* Request body: `{ "targetParent": "<Notion page URL or ID>" }`
* Latest restore report: `GET /api/runs/:id/restore/latest`
* Service entry point: `restoreRunToNotion({ runId, targetParentId, token })`
* Latest report helper: `getLatestRestoreReport(runId)`
* Latest restore report: `runs/<run-key>/restore-manifest.json`
* Restore manifest: `runs/<run-key>/restores/<restore-id>/restore-manifest.json`

### 3. Contracts

* Restore starts from canonical page JSON artifacts under `pages/<page-id>.json`; Markdown must not be used when page JSON exists.
* Restore creates new Notion pages under a target parent page. It must not overwrite, move, or delete original Notion content.
* `targetParent` accepts Notion URL or ID and is normalized through `normalizeNotionId`.
* Restore requires an authenticated dashboard session and a configured Notion token.
* Restore supports successful page run items and successful data source run items.
* Standalone page creation under the selected target parent restores title and compatible emoji/icon/custom emoji/external icons plus external covers. Non-title page properties cannot be written to a plain page parent and must be warned.
* Data source entry page creation under a restored data source can restore supported writable page property values; unsupported/read-only values must be warned.
* Block conversion must strip response-only fields and downgrade unsupported rich text mentions to plain text with warnings.
* Child pages are restored recursively when their page JSON artifact exists.
* Notion-hosted/local file upload restore is not implemented in this MVP. External media URLs may be reattached; Notion-hosted file blocks must warn and skip.
* The restore report uses shared `RestoreReport` DTO and records status, mappings, item results, warnings, errors, and `manifestPath`.

### 4. Validation & Error Matrix

* Missing login -> `401 unauthorized`.
* Missing Notion token -> `400 bad_request` with "请先设置有效的 Notion token".
* Empty `targetParent` -> `400 bad_request` with "请输入目标 Notion 父页面 URL 或 ID".
* Invalid target parent URL/ID -> `400 bad_request` from Notion ID normalization.
* Missing run -> `404 not_found`.
* Missing artifact directory -> `404 not_found`.
* Missing backup `manifest.json` -> `404 not_found`.
* No successful run items -> `400 bad_request`.
* Data source run item with missing `schema.json` or `entries.json` -> fail that item.
* Unsupported data source schema property -> skip that property and warn by name/type.
* Unsupported block/property/comment/file behavior -> warning in restore report, not silent success.

### 5. Good/Base/Bad Cases

* Good: user starts restore from a successful run, page JSON is read, new pages are created, block mappings are recorded, and `restore-manifest.json` is written.
* Base: run includes data source, unsupported schema properties, or unsupported blocks; supported pages/data sources restore and report status becomes `partial_failed` when items are skipped/failed.
* Bad: restore uses `markdown/<page-id>.md`, silently drops relation/comment/file information, or claims original Notion IDs were preserved.

### 6. Tests Required

* Block conversion tests must assert response-only rich text fields are removed.
* Mention downgrade tests must assert warnings are emitted.
* Child page conversion tests must assert recursive page restore action.
* File block tests must assert Notion-hosted file upload is skipped with warning until upload restore exists.
* Page artifact warning tests must assert skipped properties/comments are reported.
* Data source restore tests must assert schema conversion, page property conversion, data source summary/mapping fields, and relation/schema warning behavior.
* Status resolution tests must assert skipped-only restores fail and mixed restores are partial.
* API/shared DTO changes must pass `npm run lint`, `npm run build`, and targeted Vitest tests.

### 7. Wrong vs Correct

#### Wrong

```ts
const markdown = await readFile(`markdown/${pageId}.md`, "utf8");
await notion.createPage({ parent, markdown });
```

#### Correct

```ts
const artifact = await readPageArtifact(runDir, pageId);
const restoredPage = await notion.createPage(createPageBody(targetParentId, artifact.page, title));
await appendBlocks(restoredPage.id, artifact.blocks);
```

## Scenario: Data Source and Page Property Restore

### 1. Scope / Trigger

* Trigger: Any change to data source restore, page property conversion, restore summary fields, or data source old-to-new mappings.

### 2. Signatures

* Start restore remains `POST /api/runs/:id/restore`.
* Service entry point remains `restoreRunToNotion({ runId, targetParentId, token })`.
* Data source artifacts read from `runs/<run-key>/data-sources/<data-source-id>/schema.json` and `entries.json`.
* Entry page artifacts read from `runs/<run-key>/pages/<entry-page-id>.json`.
* Notion container creation uses `POST /databases` with `initial_data_source`.
* Entry page creation uses `POST /pages` with parent `{ "type": "data_source_id", "data_source_id": "<new-id>" }`.
* `RestoreReport.summary.createdDataSources` records created data source count.
* `RestoreItemResult.newDataSourceId` records the restored data source ID for data source items.

### 3. Contracts

* Data source restore creates a new database/data source under the selected target parent page; it must not overwrite, move, or delete source content.
* The restore report must record `mappings.dataSources[oldDataSourceId] = newDataSourceId`.
* Data source schema conversion should keep stable writable schema types: `title`, `rich_text`, `number`, `select`, `multi_select`, `status`, `date`, `checkbox`, `url`, `email`, `phone_number`, `files`, `people`, `unique_id`, created/edited metadata, and `place` when accepted by the API.
* Relation, rollup, formula, button, location, verification, and last-visited schema properties are skipped with warnings in the current slice.
* Page property conversion should keep writable values: title, rich text, number, checkbox, select, multi-select, status, date, URL, email, phone number, place, external file references, and mapped relations.
* Select/status/multi-select values must be sent by name/color/description, not old option IDs.
* Rich text and property values must strip response-only fields such as `plain_text`, `href`, and old option IDs.
* Local/Notion-hosted file values remain out of scope; external file references may be preserved.
* Relation values may be written only for pages that already have an old-to-new page mapping. Unmapped relations are skipped with warnings.

### 4. Validation & Error Matrix

* Missing data source `schema.json` -> item failure with a user-facing artifact error.
* Missing data source `entries.json` -> item failure with a user-facing artifact error.
* Database/data source create response lacks a new data source ID -> item failure with `Notion 未返回新数据源 ID`.
* Entry page artifact missing -> data source item can still create the container, records an entry failure warning/error, and final report becomes partial.
* Unsupported schema property -> skip property and add a restore warning with property name/type.
* Page property not present in the restored schema -> skip value and add `page_property_schema_missing`.
* Unmapped relation page -> skip that relation target and add `relation_property_unresolved`.

### 5. Good/Base/Bad Cases

* Good: selected data source restores a new data source, creates entry pages under it, records data source and page mappings, writes supported properties, and warns for unsupported fields.
* Base: data source has relation/formula/rollup/local files; stable schema and values restore, unsupported parts are visible as warnings, and status may be partial.
* Bad: restore silently drops properties, sends old select option IDs to a new data source, or claims formulas/rollups/relations were fully restored when they were skipped.

### 6. Tests Required

* Schema conversion tests assert writable schema output and warning codes for skipped relation/formula/rollup properties.
* Page property conversion tests assert response-only fields are stripped and supported values are retained.
* File property tests assert external files are preserved and Notion/local files warn.
* Relation tests assert mapped relation IDs are rewritten and unmapped IDs warn.
* Restore status tests assert created data sources count toward partial success.
* Shared DTO/UI changes must pass `npm run lint`, `npm run build`, and `npm test`.

### 7. Wrong vs Correct

#### Wrong

```ts
// Old IDs from the source data source do not belong to the new data source.
properties.Status = { status: { id: oldStatusOptionId } };
```

#### Correct

```ts
// Recreate values by stable names/options and let Notion assign new IDs.
properties.Status = { status: { name: oldStatusOptionName } };
```

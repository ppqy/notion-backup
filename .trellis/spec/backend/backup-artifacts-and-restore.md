# Backup Artifacts and Restore Contracts

## Overview

Backup artifacts are durable filesystem outputs under `BACKUP_ROOT`. JSON artifacts are the canonical backup record. Markdown is a derived human-readable/import helper and must not be treated as the source of truth when JSON is available.

Restore/import is a best-effort workflow. It can recreate content into new Notion objects, but it cannot preserve original Notion object IDs, edit history, permissions, or every read-only/computed value.

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
* Data source view artifact: `data-sources/<data-source-id>/views.json`.
* Markdown artifact: `markdown/<page-id>.md`.
* Asset artifact: `assets/<page-id>/manifest.json` plus downloaded files.
* Zip artifact: `archive.zip`, generated on demand from a run directory.

### 3. Contracts

* `manifest.json` records run status, partial state, plan snapshot, selected items, per-item result/error metadata, and skipped file count.
* `pages/<page-id>.json` is canonical and contains the page object, complete property item payloads where available, recursive block JSON, optional comments or comment backup failure metadata, and optional Markdown API response.
* `data-sources/<data-source-id>/schema.json` stores the retrieved data source object and schema.
* `data-sources/<data-source-id>/entries.json` stores queried data source entry pages; each entry page must also be backed up through the page artifact path.
* `data-sources/<data-source-id>/views.json` stores the source data source ID, capture status, retrieved full view objects, and warnings for failed list/retrieve operations.
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
* Data source view list/retrieve failure during backup -> write a `views.json` artifact with `failed` or `partial_failed` status plus warning details; do not silently claim all views were captured.

### 5. Good/Base/Bad Cases

* Good: future restore reads `pages/<page-id>.json`, uploads local assets, appends block JSON, then uses Markdown only for preview or fallback.
* Base: user manually imports files from `markdown/` and the UI labels this as low-fidelity manual import.
* Bad: restore reconstructs pages from Markdown while ignoring available page JSON, property items, block JSON, and asset manifests.

### 6. Tests Required

* Artifact shape changes need unit or integration coverage asserting required files and key manifest fields.
* Asset behavior changes need tests for downloaded, skipped, and external URL cases.
* View artifact changes need tests for manifest capability gating, paginated view listing, full view retrieval, persisted warning artifacts, and failed list/retrieve cases.
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

## Scenario: Data Source View Artifact Backup

### 1. Scope / Trigger

* Trigger: Any change to Notion Views API integration, data source backup artifacts, data source manifest capabilities, or future view-aware restore preflight.

### 2. Signatures

* Notion wrapper methods:
  * `listDataSourceViews(dataSourceId, startCursor?)` -> paginated view references from `GET /views?data_source_id=...`.
  * `retrieveView(viewId)` -> full view object from `GET /views/<view-id>`.
* Artifact path: `runs/<run-key>/data-sources/<data-source-id>/views.json`.
* Artifact shape: `{ dataSourceId, status, views, warnings }`.
* Artifact status: `succeeded`, `partial_failed`, or `failed`.
* Manifest capability/artifact kind: `data_source_views`.

### 3. Contracts

* Data source backups must write `views.json` alongside `schema.json` and `entries.json`.
* `views` must contain full retrieved view objects, not only list references, because restore needs filters, sorts, quick filters, configuration, and property references.
* View objects must preserve raw property IDs/names so a later restore pass can remap old property IDs to new property IDs.
* A backup manifest may claim `data_source_views` only for plans that include selected data source backups that write view artifacts.
* Page-only backup manifests must not claim `data_source_views`.
* `restoreViews: true` may be accepted only by view-aware restore code that gates on manifest capability, reads `views.json`, remaps property IDs, and creates views through the Notion Views API.

### 4. Validation & Error Matrix

* View list succeeds and all retrieve calls succeed -> `views.json.status = "succeeded"`.
* View list fails -> write `views.json.status = "failed"`, keep `views = []`, add `data_source_views_list_failed`, and log `data_source_views_failed`.
* One view retrieve fails -> write `views.json.status = "partial_failed"`, keep successfully retrieved views, add `data_source_view_retrieve_failed`, and log `data_source_view_failed`.
* View reference has no string `id` -> skip that reference, add `data_source_view_reference_invalid`, and log the warning without dumping full view payloads.
* Backup cancellation -> propagate cancellation instead of converting it to a view warning.

### 5. Good/Base/Bad Cases

* Good: data source backup writes schema, entries, entry page artifacts, and full raw view objects with old property references preserved.
* Base: one view is inaccessible; backup keeps the other views and writes a partial warning artifact.
* Bad: backup stores only list references, claims `data_source_views` for page-only plans, or restores views without explicit artifact/capability gating and property remapping.

### 6. Tests Required

* Manifest helper tests assert data source plans include `data_source_views` and page-only plans do not.
* View artifact tests assert pagination, full view retrieval, raw property reference preservation, and `views.json` persistence.
* Failure tests assert list/retrieve failures produce warning artifacts and structured run logs.
* Restore validation and preflight tests must assert `restoreViews: true` is explicit, capability-gated, and artifact-aware.
* Full quality gate: `npm run lint`, `npm test`, and `npm run build`.

### 7. Wrong vs Correct

#### Wrong

```ts
// List references do not contain enough configuration for future restore.
const views = await notion.listDataSourceViews(dataSourceId);
await writeJson(`data-sources/${dataSourceId}/views.json`, views.results);
```

#### Correct

```ts
const references = await notion.listDataSourceViews(dataSourceId);
const views = [];
for (const reference of references.results) {
  views.push(await notion.retrieveView(reference.id));
}
await writeJson(`data-sources/${dataSourceId}/views.json`, { dataSourceId, status: "succeeded", views, warnings: [] });
```

## Scenario: Data Source View Restore

### 1. Scope / Trigger

* Trigger: Any change to `RestoreOptions.restoreViews`, `views.json` restore handling, Notion view creation, view property ID remapping, restore preflight gating, or view restore report mappings/metrics.

### 2. Signatures

* Restore request body: `{ "targetParent": "<Notion page URL or ID>", "options"?: { "restoreViews"?: boolean } }`.
* Notion wrapper method: `createView(body)` -> `POST /views`.
* View artifact input: `runs/<run-key>/data-sources/<data-source-id>/views.json`.
* Restore output mappings: `RestoreReport.mappings.views[oldViewId] = newViewId`.
* Restore summary metric: `RestoreReport.summary.createdViews`.

### 3. Contracts

* View restore is opt-in. Default restore behavior must keep `restoreViews: false`.
* Preflight must warn when `restoreViews` is requested but the backup manifest lacks `data_source_views` or a selected data source lacks a readable `views.json`.
* Restore may create views only after creating the target database/data source and reading target property IDs.
* Property references in filters, sorts, quick filters, and configuration must be remapped from old property IDs to new property IDs when possible.
* If a property ID cannot be mapped, omit/degrade the affected view field and record a warning; do not silently send old property IDs to Notion.
* Unsupported view types or dashboard/widget shapes should be skipped with warnings until explicitly supported.
* View creation failures are restore warnings for the affected data source view; they do not delete created Notion content.

### 4. Validation & Error Matrix

* `restoreViews` omitted or false -> skip view restore and keep existing page/data-source restore behavior.
* Backup manifest lacks `data_source_views` -> preflight/runtime warning and skip view restore.
* `views.json` missing or invalid -> preflight/runtime warning and skip view restore for that data source.
* `views.json.status = failed` -> warn and only attempt any view objects present in the artifact.
* `views.json.status = partial_failed` -> warn and restore only successfully captured view objects.
* Target data source property IDs cannot be read -> warn and degrade view property remapping.
* View type unsupported or required property mapping missing -> skip/degrade that view with warning.
* Notion `POST /views` fails -> record `view_restore_failed` warning and continue.

### 5. Good/Base/Bad Cases

* Good: a backup with `data_source_views` restores a new data source, remaps view property IDs, creates supported views, records `mappings.views`, and increments `summary.createdViews`.
* Base: a view has an unsupported filter/config field; the data source and other views restore, while the unsupported field/view is warned.
* Bad: restore infers views from `schema.json`, sends old property IDs to the new data source, or claims views restored when `views.json` is missing.

### 6. Tests Required

* Validation tests assert `restoreViews: true` is accepted while unimplemented restore options remain rejected.
* Preflight tests assert missing capability/artifact and partial/failed artifact warnings.
* View conversion tests assert property ID remapping, response-only field stripping, unsupported view warnings, and missing mapping warnings.
* Restore report tests assert `createdViews` defaults safely for old manifests and is persisted in summary metrics.
* Full quality gate: `npm run lint`, `npm test`, and `npm run build`.

### 7. Wrong vs Correct

#### Wrong

```ts
// Old IDs from the source data source do not belong to the restored data source.
await notion.createView({ data_source_id: newDataSourceId, filter: oldView.filter });
```

#### Correct

```ts
const request = convertDataSourceViewForRestore(oldView, {
  targetDatabaseId: newDatabaseId,
  targetDataSourceId: newDataSourceId,
  propertyMappings
});
if (request.request) {
  const created = await notion.createView(request.request);
  report.mappings.views[oldView.id] = created.id;
}
```

## Design Decision: Restore Is Best-Effort Recreation

**Context**: Notion's API supports creating pages, databases/data sources, block children, and file uploads, but created objects receive new IDs and API coverage does not include every workspace/UI detail.

**Decision**: Treat restore/import as best-effort recreation. The feature must write a restore manifest containing old-to-new ID mappings, warnings, skipped fields, partial failures, and target object IDs.

**Must Not Claim**:

* Original page/block/data source IDs are preserved.
* Original URLs, edit history, permissions, or comments history are restored.
* Read-only/computed values such as formulas, rollups, created time, created by, last edited time, and last edited by can be written back exactly.
* That views are restored just because backup artifacts contain `views.json`. View-aware restore must still be explicitly requested and must record warnings for unsupported view configuration or missing property mappings.

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
* Restore should upload downloaded Notion-hosted/local asset files through Notion File Uploads when `assets/<page-id>/manifest.json` has a matching downloaded file. External media URLs may still be reattached directly.
* Restore should recreate backed-up comments only when `restoreComments` is true and the comment parent can be mapped to a restored page or block. Comment authors, timestamps, resolved state, exact discussion history, and original comment IDs are not preserved.
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
* File block tests must assert external media stays external, downloaded Notion-hosted files become `file_upload` payloads, and missing/skipped assets warn.
* Page artifact warning tests must assert skipped properties/comments are reported.
* Comment restore tests must assert mapped page/block target conversion, missing target warnings, attachment warnings, `mappings.comments`, and `summary.createdComments`.
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

## Scenario: Best-Effort Comment Restore

### 1. Scope / Trigger

* Trigger: Any change to `RestoreOptions.restoreComments`, comment backup shape, Notion comment creation, comment target mapping, or restore comment report metrics.

### 2. Signatures

* Restore request body: `{ "targetParent": "<Notion page URL or ID>", "options"?: { "restoreComments"?: boolean } }`.
* Comment artifact input: `pages/<page-id>.json.comments`, normally the Notion comments list response captured during backup. If comment backup fails, write structured failure metadata under the same field with `status: "failed"`, `results: []`, and `warnings[]`.
* Notion wrapper method: `createComment(body)` -> `POST /comments`.
* Restore output mappings: `RestoreReport.mappings.comments[oldCommentId] = newCommentId`.
* Restore summary metric: `RestoreReport.summary.createdComments`.

### 3. Contracts

* Comment restore is opt-in. Default restore behavior must keep `restoreComments: false`.
* Comment backup requires a Notion connection with `Read comments`; comment restore requires `Insert comments`. If Notion returns `403 Insufficient permissions for this endpoint` while reading comments, the page artifact should preserve a `comments_read_permission_missing` warning so preflight/runtime reports explain that comments were not backed up.
* Comment restore may run only after target page/block mappings exist.
* A comment may be restored only when its parent page/block maps to a newly restored page/block in the same restore run.
* Rich text must be sanitized through the same response-field stripping and mention-downgrade path used for block/page rich text.
* Comment attachments, original authors, timestamps, resolved state, exact discussion history, and original comment IDs are not preserved.
* Comment creation failures are restore warnings; they do not fail the restored page/data source item.

### 4. Validation & Error Matrix

* `restoreComments` omitted or false -> skip comment creation and warn at runtime when backed-up comments are present.
* `restoreComments: true` and page has no backed-up comments -> preflight/runtime warning, no runtime failure. If comment backup failure metadata is present, surface its warning message instead of a generic missing-comments warning.
* Comment parent has no page/block mapping -> skip that comment with `comment_target_unmapped`.
* Comment has no readable rich text -> skip that comment with `comment_rich_text_missing`.
* Comment has attachments -> restore text only and warn with `comment_attachments_skipped`.
* Notion `POST /comments` returns a permission error -> warn with `comments_insert_permission_missing` and continue.
* Other Notion `POST /comments` failures -> warn with `comment_restore_failed` and continue.

### 5. Good/Base/Bad Cases

* Good: a restored page has backed-up comments whose parent page ID maps to the new page; restore creates new Notion comments, records comment mappings, and increments `createdComments`.
* Base: one backed-up comment points at an unmapped block; other comments restore and the unmapped one is warned.
* Bad: restore claims original comment authors/timestamps were preserved, or creates comments on the target parent page when the original comment target could not be mapped.

### 6. Tests Required

* Validation tests assert `restoreComments: true` is accepted while unimplemented options remain rejected.
* Preflight tests assert missing comment artifacts produce warnings when comment restore is requested.
* Comment conversion tests assert page/block target mapping, missing target warnings, attachment warnings, and response-only rich text stripping.
* Restore report compatibility tests assert `createdComments` defaults safely for old manifests.
* Full quality gate: `npm run lint`, `npm test`, and `npm run build`.

### 7. Wrong vs Correct

#### Wrong

```ts
// This fabricates a target and makes the restored comment misleading.
await notion.createComment({ parent: { page_id: targetParentId }, rich_text: oldComment.rich_text });
```

#### Correct

```ts
const mappedPageId = report.mappings.pages[oldComment.parent.page_id];
if (!mappedPageId) {
  warn("comment_target_unmapped");
  return;
}
const created = await notion.createComment({ parent: { type: "page_id", page_id: mappedPageId }, rich_text });
report.mappings.comments[oldComment.id] = created.id;
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
* Local/Notion-hosted file values should use downloaded asset manifests and single-part File Uploads when files are available and at or below the single-part size limit. External file references may be preserved.
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
* Base: data source has relation/formula/rollup/missing or oversized local files; stable schema and values restore, unsupported parts are visible as warnings, and status may be partial.
* Bad: restore silently drops properties, sends old select option IDs to a new data source, or claims formulas/rollups/relations were fully restored when they were skipped.

### 6. Tests Required

* Schema conversion tests assert writable schema output and warning codes for skipped relation/formula/rollup properties.
* Page property conversion tests assert response-only fields are stripped and supported values are retained.
* File property tests assert external files are preserved, downloaded Notion/local files become `file_upload` values, and missing/skipped assets warn.
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

## Scenario: Restore Downloaded Files Through File Uploads

### 1. Scope / Trigger

* Trigger: Any change to restore handling for media/file blocks, `files` page properties, asset manifests, or Notion File Upload integration.

### 2. Signatures

* Asset manifest path: `runs/<run-key>/assets/<page-id>/manifest.json`.
* Asset manifest entry: backup `DownloadResult` with `candidate.url`, `candidate.name`, `status`, and either downloaded `path`/`bytes` or skipped `reason`.
* Notion wrapper methods:
  * `createSinglePartFileUpload({ filename, contentType })`
  * `sendFileUpload({ fileUploadId, filename, data })`
* Restore output mapping: `RestoreReport.mappings.files[oldFileUrl] = newFileUploadId`.

### 3. Contracts

* Restore only uploads files already downloaded by backup. Do not fetch expired Notion-hosted URLs during restore.
* A backed-up `file` media block or `files` property value may become `{ type: "file_upload", file_upload: { id } }` when a matching downloaded asset exists.
* External media/file URLs should keep using `external` payloads unless a future feature explicitly imports external URLs.
* Single-part upload is limited to files at or below 20 MiB. Larger files must warn until multipart upload is implemented.
* Upload IDs are cached per restore run by original file URL so repeated references do not upload the same file more than once.
* File upload filenames should preserve Unicode names from Notion/file metadata. Only replace path separators, control characters, and filesystem/API-unsafe punctuation such as `< > : " / \ | ? *`.
* Missing/skipped assets are warnings, not silent drops and not whole-run failures.

### 4. Validation & Error Matrix

* Missing `assets/<page-id>/manifest.json` -> `asset_manifest_missing` warning.
* No manifest entry for the original file URL -> `asset_not_downloaded` warning.
* Manifest entry has `status: "skipped"` -> `asset_download_skipped` warning with the backup skip reason.
* Downloaded file path missing -> `asset_file_missing` warning.
* Downloaded file is larger than 20 MiB -> `file_upload_multipart_required` warning.
* Notion upload response lacks an ID or does not finish as `uploaded` -> `file_upload_failed` warning.
* Restore cancellation requested before upload or before the following Notion write -> terminal canceled restore behavior.

### 5. Good/Base/Bad Cases

* Good: a backed-up Notion-hosted PDF block has a matching downloaded asset, restore uploads it once, appends a `file_upload` block, and records the old URL to new upload ID mapping.
* Base: a page has mixed external and Notion-hosted file properties; external values remain external, downloaded Notion-hosted values become file uploads, and missing local assets warn.
* Bad: restore tries to reuse the original expired Notion-hosted file URL, silently drops the file, or uploads the same backed-up file repeatedly for every reference.

### 6. Tests Required

* Block conversion tests assert `file_upload` payload creation when a resolver supplies an upload and warning preservation when an asset cannot upload.
* Page property conversion tests assert `files` values can include `file_upload` entries while external entries remain unchanged.
* Filename tests assert Chinese/Unicode names are preserved while path-unsafe characters are replaced.
* Restore execution changes should pass `npm test`, `npm run lint`, and `npm run build`.

### 7. Wrong vs Correct

#### Wrong

```ts
// Original Notion-hosted URLs expire; restoring them as external links is unreliable.
return { type: "file", file: { type: "external", external: { url: oldFileUrl } } };
```

#### Correct

```ts
const uploadId = await uploadDownloadedAsset(asset.path);
report.mappings.files[oldFileUrl] = uploadId;
return { type: "file", file: { type: "file_upload", file_upload: { id: uploadId } } };
```

## Scenario: Restore Warning Summaries

### 1. Scope / Trigger

* Trigger: Any change to restore warning DTOs, restore preflight output, restore report persistence, restore report readers, or warning UI display.

### 2. Signatures

* Raw warning item: `RestoreWarning { code, message, objectId?, blockId?, details? }`.
* Grouped warning item: `RestoreWarningSummary { code, severity, title, message, count, examples }`.
* Preflight restore response includes both `warnings` and `warningSummaries`.
* Restore manifest/report includes both `warnings` and `warningSummaries`.

### 3. Contracts

* `warnings` remains the raw audit trail and must not be removed or deduplicated.
* `warningSummaries` is derived from raw warnings and groups repeated warnings by stable warning `code`.
* Informational notices, such as restore creating new content, should use `severity: "info"` so the UI can separate them from actionable warnings.
* Restore report readers must regenerate `warningSummaries` from raw `warnings` when loading old manifests that lack the grouped field.
* `summary.warningCount` should reflect the raw `warnings.length`, not the grouped summary count.

### 4. Validation & Error Matrix

* Old restore manifest lacks `warningSummaries` -> normalize safely by deriving summaries from `warnings`.
* Malformed or missing raw `warnings` -> normalize to an empty raw warning list and empty summaries.
* Unknown warning code -> group by the unknown code with a fallback title/message; do not drop it.
* Repeated warnings across many pages -> display one summary group with a count and a few examples.

### 5. Good/Base/Bad Cases

* Good: 100 pages missing comments render as one "页面评论缺失" summary with count 100 and example page warnings, while the manifest still stores all 100 raw warnings.
* Base: a restore report has only one warning; it still appears as one summary group with one example.
* Bad: UI slices the first few raw warnings and hides the rest behind a remaining count, causing repeated warning noise and weak diagnostics.

### 6. Tests Required

* Warning summary helper tests assert repeated warning grouping, example retention, and info-vs-warning severity ordering.
* Restore preflight tests assert `warningSummaries` exists alongside raw `warnings`.
* Restore report compatibility tests assert old manifests derive `warningSummaries` and preserve accurate `summary.warningCount`.
* Full quality gate: `npm run lint`, `npm test`, and `npm run build`.

### 7. Wrong vs Correct

#### Wrong

```ts
const warnings = report.warnings.slice(0, 8);
```

#### Correct

```ts
const summaries = summarizeRestoreWarnings(report.warnings);
```

## Scenario: Restore Run History, Preflight, and Cooperative Cancellation

### 1. Scope / Trigger

* Trigger: Any change to restore job persistence, restore history APIs, restore worker behavior, restore preflight, restore cancellation, or backup cancellation semantics.

### 2. Signatures

* Preflight restore: `POST /api/runs/:id/restore/preflight`
* Enqueue restore: `POST /api/runs/:id/restore`
* List restore runs: `GET /api/restores`
* Restore detail: `GET /api/restores/:id`
* Cancel restore: `POST /api/restores/:id/cancel`
* Restore DB tables: `restore_runs`, `restore_run_items`
* Restore worker entry point: `RestoreWorker.start()`
* Backup cancellation remains `POST /api/runs/:id/cancel`

### 3. Contracts

* Restore preflight validates the source backup run, manifest, target parent page access, and expected artifact presence without calling Notion write APIs.
* Starting restore enqueues a durable `restore_runs` row and returns immediately; the HTTP request must not block on Notion content creation.
* Restore history is a top-level dashboard workflow. Backup run detail can start a restore, but ongoing/completed jobs are monitored through `/api/restores`.
* Restore worker claims queued restore jobs, updates progress counters, writes the normal restore manifest, and stores the manifest path on `restore_runs.manifest_path`.
* Restore cancellation is cooperative. It stops future work at safe checkpoints, writes a canceled/partial report, and must not delete Notion content already created.
* Backup cancellation is cooperative too. Queued backup cancellation should become terminal `canceled`; running backup cancellation should be checked during long page/data-source/block/file loops and preserve already-written artifacts.

### 4. Validation & Error Matrix

* Missing login -> `401 unauthorized`.
* Missing Notion token -> `400 bad_request` before preflight/enqueue or failed restore job if the token disappears before worker execution.
* Invalid target parent URL/ID -> `400 bad_request`.
* Target parent not shared with integration -> `400 bad_request` with "目标父页面不可访问".
* Missing backup artifact directory or manifest -> restore preflight/enqueue fails before creating a restore job.
* Queued restore cancel -> terminal `canceled` and pending items become skipped.
* Running restore cancel -> `cancel_requested` until the worker reaches a safe checkpoint, then terminal `canceled`.
* Queued backup cancel -> terminal `canceled`; it must not remain stuck in `cancel_requested`.
* Running backup cancel -> terminal `canceled` after the worker reaches a safe checkpoint and writes a canceled manifest.

### 5. Good/Base/Bad Cases

* Good: user preflights a completed backup, sees expected pages/data sources and warnings, starts a restore job, watches it progress in the "恢复" page, and can revisit the final report.
* Base: user cancels a restore after some pages were created; the report says the restore was canceled and keeps mappings for created content.
* Bad: `POST /api/runs/:id/restore` holds the HTTP request open until all Notion writes finish, or cancellation deletes Notion content/files without explicit user control.

### 6. Tests Required

* Preflight tests assert expected counts and artifact warnings without Notion writes.
* Worker/repository tests should cover status transitions for queued, running, canceled, failed, and completed restore jobs when practical.
* Backup cancellation changes must verify queued cancellation does not leave stale `cancel_requested` rows and running cancellation preserves partial artifacts.
* API/shared DTO changes must pass `npm run lint`, `npm run build`, and targeted Vitest tests.

### 7. Wrong vs Correct

#### Wrong

```ts
// Synchronous restore hides progress and cannot be canceled once started.
app.post("/api/runs/:id/restore", async (request) => {
  return restoreRunToNotion({ runId: id, targetParentId, token });
});
```

#### Correct

```ts
// Enqueue a durable restore job and let RestoreWorker update progress.
app.post("/api/runs/:id/restore", async (request) => {
  await preflightRestoreRun({ runId: id, targetParentId, token });
  return createRestoreRun(getRun(id), targetParentId);
});
```

## Scenario: Versioned Manifest and Restore Model Foundation

### 1. Scope / Trigger

* Trigger: Any change to backup `manifest.json`, restore enqueue payloads, restore DB schema, restore report DTOs, or readers for old restore manifests.
* Trigger: Any future restore feature that needs capability gating or selected behavior persisted for auditability.

### 2. Signatures

* Current backup manifest fields: `schemaVersion`, `capabilities`, and `artifactKinds`.
* Legacy backup manifest: missing `schemaVersion` means implicit v1.
* Restore request body: `{ "targetParent": "<Notion page URL or ID>", "options"?: RestoreOptions }`.
* Current `RestoreOptions`: `{ restoreComments: false, restoreViews: false, importExternalUrls: false, relationStrategy: "mapped_only" }`.
* Restore DB fields: `restore_runs.options_json` and `restore_runs.summary_json`, both nullable.
* Restore report fields: `options`, `summary`, and `mappings` with defaults for `pages`, `blocks`, `dataSources`, `files`, `properties`, `views`, `databases`, and `comments`.

### 3. Contracts

* New backup runs must write `schemaVersion`, `capabilities`, and `artifactKinds` to `manifest.json`.
* Backup runs with selected data sources may claim `data_source_views` only because `views.json` artifacts are written; page-only runs must not claim that capability.
* Legacy manifests without `schemaVersion` must remain restorable for current page/data-source/file behavior and should produce a preflight compatibility warning.
* Restore enqueue must store normalized restore options in `restore_runs.options_json`.
* Restore execution must write selected restore options into the restore manifest/report.
* Restore progress/completion must store extensible summary metrics in `restore_runs.summary_json` while keeping fixed dashboard counter columns populated.
* Restore report readers must default missing future mapping buckets to `{}` and missing numeric summary fields to `0`.

### 4. Validation & Error Matrix

* Restore body omits `options` -> use current default restore options.
* Restore body sets `restoreComments: true` -> accept only as an explicit opt-in and recreate comments best-effort from backed-up comment JSON.
* Restore body sets `importExternalUrls` to `true` before implementation -> reject with a localized `400 bad_request`.
* Restore body sets `restoreViews: true` -> accept only as an explicit opt-in and gate behavior on backup manifest/artifacts before Notion writes.
* Backup manifest lacks `schemaVersion` -> treat as legacy v1 and do not infer support for new artifact capabilities.
* Backup manifest has missing or unknown `capabilities` / `artifactKinds` -> ignore unknown values and default missing arrays safely.
* Old restore manifest lacks `options`, `mappings.properties`, `mappings.views`, or future summary counts -> readers default safely instead of crashing UI/API consumers.

### 5. Good/Base/Bad Cases

* Good: a new backup manifest advertises only capabilities actually written, restore enqueue stores default options, restore report includes options plus extensible mappings, and old reports still render.
* Base: an old backup manifest without `schemaVersion` preflights with a legacy warning but can still restore supported current artifacts.
* Bad: restore view option creates inferred/default views when no view artifacts exist, or a reader assumes `mappings.views` exists and crashes on old manifests.

### 6. Tests Required

* Manifest helper tests assert current schema metadata, legacy v1 defaulting, data source view capability gating, and page-only runs not claiming `data_source_views`.
* Migration tests assert `options_json` and `summary_json` are additive, nullable, and preserve existing restore rows.
* Validation tests assert omitted options default safely and unsupported future options are rejected.
* Restore report compatibility tests assert missing options, mappings, and summary fields default safely.
* Full quality gate: `npm run lint`, `npm test`, and `npm run build`.

### 7. Wrong vs Correct

#### Wrong

```ts
// Missing schemaVersion is not proof that the backup supports every new restore feature.
if (!manifest.schemaVersion) {
  await restoreViewsFromSchemaOnly();
}
```

#### Correct

```ts
const manifest = readBackupManifestMetadata(manifestPath);
if (!manifest.capabilities.includes("data_source_views")) {
  warn("view_artifacts_missing");
}
```

#### Wrong

```ts
// Old restore manifests may not have future mapping buckets.
const restoredViewId = report.mappings.views[oldViewId];
```

#### Correct

```ts
const report = normalizeRestoreReport(rawReport);
const restoredViewId = report?.mappings.views[oldViewId];
```

## Scenario: Restore Model Evolution Priority

### 1. Scope / Trigger

* Trigger: Any future restore feature that needs new persisted backup data, new old-to-new mappings, new restore options, or restore history metrics.
* Trigger: Any change that would make old backup runs unable to support a new restore feature unless the artifact format is versioned first.

### 2. Signatures

* Backup manifest versioning fields: `schemaVersion`, `capabilities`, and `artifactKinds`.
* Data source view artifacts: `runs/<run-key>/data-sources/<data-source-id>/views.json`.
* Restore run model-extension DB fields should be additive and nullable, preferably generic when the field is likely to grow:
  * `restore_runs.options_json` for restore behavior selected at enqueue time.
  * `restore_runs.summary_json` or `restore_runs.metrics_json` for created/skipped counts that do not justify a new column per feature.
* Restore report mappings include future-safe buckets such as `properties`, `views`, `databases`, and `comments`.
* Restore report future summary may include feature-specific counts such as `createdViews`, `createdComments`, `uploadedFiles`, or `uploadedBytes`.

### 3. Contracts

* Model-affecting restore work must be prioritized before implementation-only restore gaps to reduce later migration risk.
* P0 model-first gaps:
  * View-aware restore. Backups with selected data sources can store view objects in `views.json`; restore must keep property ID remapping, unsupported configuration handling, and explicit Notion view creation capability-gated.
  * Property/data-source/view ID mapping. View restore and relation repair need old-to-new mappings beyond page/block/data source/file IDs.
  * Restore options persistence. Options such as restoring comments, restoring views, importing external URLs, or relation strategy must be stored with the restore job and manifest for auditability.
  * Extensible restore metrics. Avoid adding a new SQLite column for every future count when a nullable JSON summary can preserve history without repeated migrations.
* Implemented model-sensitive restore slices:
  * Best-effort comment recreation uses current page `comments` artifacts when `restoreComments` is true. It can create new comments on mapped restored pages/blocks, but cannot preserve original authors, timestamps, resolved state, exact discussion history, or original comment IDs.
* P1 model-sensitive gaps:
  * External URL import mode should use restore options and manifest warnings/mappings; it should not change existing external-file restore semantics silently.
* P2 implementation-first gaps:
  * Multipart uploads for files larger than 20 MiB can reuse current asset manifest `path`/`bytes` data and mostly affects Notion upload flow.
  * File-backed page icons/covers can reuse current asset collection if a matching file object exists; missing matches should warn.
  * Data source name-level icons require a data source update pass after database/data source creation. Database `icon/cover` restore alone does not restore the data source title row icon.
  * Additional block/property type support should use current page JSON first and add warnings when a type still cannot be restored.

### 4. Validation & Error Matrix

* Restore request has feature options but `restore_runs.options_json` is absent -> reject or fall back only if the feature is explicitly documented as stateless.
* Backup manifest lacks `schemaVersion` -> treat as legacy v1 and do not claim support for artifacts added later.
* Backup manifest lacks the required capability for a feature, such as `data_source_views` -> preflight warning or hard failure according to the feature policy before Notion writes.
* View restore requested but no view artifacts exist -> preflight warning/failure; do not create default views and call them restored views.
* View artifact references a property with no old-to-new property mapping -> skip or degrade that view element and record a warning.
* Comment restore requested but backed-up comments lack a targetable block/page/discussion reference -> skip those comments with warnings.
* Summary or mapping fields are absent from an old restore manifest -> UI/repository readers must default missing counts to zero and missing maps to empty objects.

### 5. Good/Base/Bad Cases

* Good: view restore uses versioned view artifacts, records property/view mappings, preflight detects legacy runs that cannot restore views, and restore history stores selected options.
* Base: a legacy run without `schemaVersion` can still restore pages/data sources/files, but preflight states that comments/views use only data present in the old artifact set.
* Bad: a new restore feature reads old artifacts as if they contain views/comments/options, silently creates approximate content, and records no feature-specific mappings or selected options.

### 6. Tests Required

* Migration tests must verify new DB fields are additive, nullable, and preserve existing rows.
* Artifact compatibility tests must load a legacy v1 run without `schemaVersion` and assert current restore still works with feature-specific warnings.
* View-aware backup tests must assert view artifact paths, schema version/capability fields, and property ID references are persisted.
* View restore tests must assert property ID remapping, missing mapping warnings, and unsupported view configuration warnings.
* Restore options tests must assert enqueue stores options and the final restore manifest includes those options.
* UI/repository tests must assert missing future summary/mapping fields in old manifests default safely.

### 7. Wrong vs Correct

#### Wrong

```ts
// Adding one column per future count makes every restore slice a DB migration.
ALTER TABLE restore_runs ADD COLUMN created_views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE restore_runs ADD COLUMN created_comments INTEGER NOT NULL DEFAULT 0;
```

#### Correct

```ts
// Keep fixed columns for core dashboard metrics; put growing feature metrics in JSON.
ALTER TABLE restore_runs ADD COLUMN options_json TEXT;
ALTER TABLE restore_runs ADD COLUMN summary_json TEXT;
```

#### Wrong

```ts
// View restore must not infer views from schema when artifacts are missing.
await restoreViewsFromDataSourceSchema(schema);
```

#### Correct

```ts
const manifest = await readRunManifest(runDir);
if (!manifest.capabilities?.includes("data_source_views")) {
  warn("view_artifacts_missing");
  return;
}
const views = await readJson(`data-sources/${dataSourceId}/views.json`);
await restoreViewsWithPropertyMappings(views, report.mappings.properties);
```

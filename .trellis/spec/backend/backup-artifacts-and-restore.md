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
* Data source views and UI layout are fully restored.

**Related Research**:

* `.trellis/tasks/05-15-notion-backup-restore-research/research/notion-json-backup-and-restore.md`

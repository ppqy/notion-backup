# Restore Options Back Into Notion

Date: 2026-05-15

## Question

Given the backup artifacts produced by this repository, what are realistic ways to restore or import a backup into Notion, and which option should be the future product direction?

## Inputs Reviewed

### Local Project Sources

* `.trellis/tasks/archive/2026-05/05-14-notion-backup-tool/prd.md`
* `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-research/research/notion-json-backup-and-restore.md`
* `.trellis/spec/backend/backup-artifacts-and-restore.md`
* `README.md` / `README_CN.md`
* `src/server/backupWorker.ts`
* `src/server/notionClient.ts`
* Sample run under `data/backups/runs/2026-05-14T09-20-25Z_ObUbJi/`
* Installed SDK types under `node_modules/@notionhq/client/build/src/`

### Official Notion Sources

* Create page: https://developers.notion.com/reference/post-page
* Append block children: https://developers.notion.com/reference/patch-block-children
* Request limits: https://developers.notion.com/reference/request-limits
* Create database: https://developers.notion.com/reference/create-database
* Create data source: https://developers.notion.com/reference/create-a-data-source
* Working with views: https://developers.notion.com/guides/data-apis/working-with-views
* Working with Markdown content: https://developers.notion.com/guides/data-apis/working-with-markdown-content
* File upload API: https://developers.notion.com/reference/file-upload
* Create comment: https://developers.notion.com/reference/create-a-comment
* Page property values: https://developers.notion.com/reference/page-property-values
* Product UI import help: https://www.notion.com/help/import-data-into-notion

## Prior Conclusion To Preserve

The prior research is still directionally correct:

* JSON remains the canonical backup artifact.
* Markdown is useful for human inspection and low-fidelity import, not high-fidelity restore.
* Restore must be described as best-effort recreation because Notion assigns new object IDs.
* A restore workflow must write a restore manifest with old-to-new ID mappings, warnings, skipped fields, and partial failure status.

The main update from the latest docs review is about views. The current backup artifacts do not include Notion view objects, so current backups cannot restore data source views. However, Notion now documents a Views API, and the installed SDK types include view endpoints. A future view-aware backup format can attempt API-supported view restoration after backing up view objects, while still avoiding claims about every UI detail.

## Current Artifact Reality

Current run layout:

```text
BACKUP_ROOT/
`-- runs/
    `-- <run-key>/
        |-- manifest.json
        |-- logs.jsonl
        |-- pages/<page-id>.json
        |-- data-sources/<data-source-id>/schema.json
        |-- data-sources/<data-source-id>/entries.json
        |-- markdown/<page-id>.md
        |-- assets/<page-id>/manifest.json
        `-- archive.zip
```

Current `pages/<page-id>.json` shape:

```json
{
  "page": {},
  "propertyItems": {},
  "blocks": [],
  "comments": null,
  "markdown": null
}
```

Current data source artifacts:

* `schema.json` stores the retrieved data source object/schema.
* `entries.json` stores query results.
* Each entry page is also backed up as a page artifact.

Important gaps for restore:

* No restore manifest exists today.
* Data source view objects are not backed up today.
* Existing assets are downloaded and tracked, but restore would still need to map original file objects to newly uploaded file objects.
* Markdown files are lossy; the sample Markdown output contains unknown markers for unsupported Notion content.

## Options

### Option 1: Manual Markdown Import

Use the existing `markdown/` folder and Notion's product UI import.

Flow:

1. Download a run zip from this app.
2. Unzip it.
3. Import selected `.md` files through Notion's UI.

Pros:

* Works with today's backup output.
* No new backend implementation.
* Good emergency path for text-heavy pages.

Cons:

* Low fidelity.
* Does not restore data source schema, entries as structured database rows, relations, comments, original hierarchy, files, IDs, permissions, or unsupported blocks.
* User must manually choose files and reconcile results.

Verdict: keep as a documented emergency import path, but do not label it "restore".

### Option 2: Automated Markdown API Import

Use Notion's Markdown page APIs to create or update page content from generated Markdown.

Pros:

* Less manual than product UI import.
* Lower implementation cost than full JSON block transformation.
* Useful for text-heavy pages where structure loss is acceptable.

Cons:

* Still low/medium fidelity because Markdown cannot represent the complete JSON backup.
* Poor fit for data source schema, relations, file properties, comments, and many rich Notion blocks.
* Can hide data loss unless warnings are explicit.

Verdict: useful as a fallback mode, not the main restore path.

### Option 3: API-Driven JSON Restore

Read canonical JSON artifacts and recreate content through Notion APIs.

Pros:

* Best alignment with current backup artifact design.
* Can restore page properties, block trees, data source entries, local assets, and relationships more accurately than Markdown.
* Can produce a precise restore report with old-to-new ID mapping and warnings.
* Can run in small batches with retry/cancel/progress semantics similar to backup runs.

Cons:

* More implementation work.
* Requires careful type conversion, chunking, dependency ordering, and partial failure handling.
* Cannot preserve original Notion IDs, URLs, edit history, permissions, authors, timestamps, or all computed values.

Verdict: recommended product direction for a real restore feature.

### Option 4: View-Aware High-Fidelity Data Source Restore

Extend backup first to capture Notion view objects, then restore data sources plus API-supported views.

Pros:

* Better recovery for databases/data sources as users actually see them.
* Notion's current docs and installed SDK types indicate view endpoints exist.

Cons:

* Current backups do not contain view artifacts, so this does not help old runs.
* View restoration depends on mapping old property IDs to new property IDs.
* Official docs should be verified with live API tests before promising complete view parity.

Verdict: phase 2 or phase 3 after JSON restore foundations are stable.

### Option 5: Browser Automation Of Notion UI Import

Drive Notion's web UI with a browser automation script.

Pros:

* Might reach UI-only import flows.

Cons:

* Brittle, credential-sensitive, hard to support in Docker, and difficult to make deterministic.
* Weak observability and poor partial failure reporting.

Verdict: not recommended.

## Recommended MVP Restore Architecture

Ship "API-driven JSON restore into a selected target parent page" first.

### User-facing workflow

1. User chooses a backup run.
2. User chooses a restore target parent page in Notion.
3. App runs preflight and displays expected limitations.
4. User starts restore.
5. App shows progress and writes a restore manifest/report.

### Backend phases

1. Preflight
   * Validate `manifest.json`.
   * Validate selected page/data source JSON exists.
   * Validate asset manifest/files according to policy.
   * Validate Notion token has required read/insert/update capabilities.
   * Validate target parent page is accessible.
   * Build dependency graph for pages, data sources, relations, mentions, child pages, and files.

2. Create containers
   * Create top-level restored pages under the selected parent.
   * Create data source/database targets when selected artifacts include data sources.
   * Drop or transform fields that Notion rejects on create.
   * Record `oldDataSourceId -> newDataSourceId` and `oldPageId -> newPageId`.

3. Create pages and entries
   * Create standalone pages and data source entry pages.
   * Set compatible properties.
   * Skip computed/read-only page values such as created time, last edited time, created by, last edited by, formula output, rollup output, and unique ID output.

4. Restore blocks
   * Convert backed-up block JSON into block creation payloads.
   * Append blocks in chunks that respect Notion request limits.
   * Recurse through children instead of assuming arbitrary nested payloads are accepted in one request.
   * Record unsupported block types and lossy conversions.

5. Restore assets
   * For backed-up local Notion files, use File Upload API flow: create upload, send bytes, complete upload, then attach the resulting file upload object where the API supports it.
   * For external URLs, reattach as external files unless the original backup mirrored them locally.
   * If a local file is missing, record a warning or item failure according to restore policy.

6. Resolve references
   * Second pass for relations, page mentions, `link_to_page`, child pages, and links that depend on old-to-new IDs.
   * Leave unresolved references empty or downgraded, and record warnings.

7. Optional comments pass
   * Creating new comments is possible through API primitives.
   * Do not claim original comment author, timestamp, discussion history, or resolved state is preserved.
   * Prefer deferring comments until core page/data source restore is stable.

8. Report
   * Write `restore-manifest.json` under the source run or a new `restores/<restore-id>/` directory.
   * Include old-to-new ID maps, per-item status, warnings, unsupported fields, skipped files, and target URLs.

## Suggested Restore Manifest Shape

```json
{
  "restoreId": "string",
  "sourceRunKey": "string",
  "targetParentId": "string",
  "status": "succeeded | partial_failed | failed | canceled",
  "startedAt": "string",
  "finishedAt": "string | null",
  "mappings": {
    "pages": { "oldPageId": "newPageId" },
    "blocks": { "oldBlockId": "newBlockId" },
    "dataSources": { "oldDataSourceId": "newDataSourceId" },
    "files": { "oldUrlOrAssetId": "newFileUploadId" }
  },
  "items": [],
  "warnings": [],
  "errors": []
}
```

## Fidelity Matrix

| Content | Manual Markdown | Markdown API | JSON API Restore |
| --- | --- | --- | --- |
| Page text | Medium | Medium | High |
| Rich text annotations | Medium | Medium | High when block/property type is supported |
| Block hierarchy | Low/Medium | Low/Medium | High with recursive append |
| Unsupported blocks | Low | Low | Explicit skip/degrade with warnings |
| Data source schema | No | No | Partial/High depending on accepted schema types |
| Data source entries | Low | Low | High for compatible page properties |
| Relations | No | No | Partial after second-pass mapping |
| Files/assets | Low | Low | Partial/High with file upload and asset manifests |
| Comments | No | No/Low | Optional best-effort new comments only |
| Views | No | No | Not from current artifacts; possible only after view backup support |
| Original IDs/URLs/history/permissions | No | No | No |

## Important Non-Goals And Limits

Do not promise:

* Original page, block, data source, comment, or file IDs.
* Original Notion URLs derived from those IDs.
* Edit history, created/last-edited identity, original timestamps, or exact comment history.
* Workspace permissions or sharing rules.
* Relations to objects that were not restored and are not accessible.
* Views from current backup runs.
* Complete UI parity, even after future view artifact support.

## Implementation Implications

* The restore feature should start from `pages/*.json` and `data-sources/*/*.json`, never Markdown when JSON exists.
* Add a dry-run/preflight API before any write operation.
* Restore should be its own run type or table, not overloading backup runs.
* The UI should say "恢复为新的 Notion 内容" rather than "回滚原 Notion 内容".
* The first implementation should keep comments and views out of MVP unless the scope explicitly expands.
* Before adding view restore, first change backup to capture view artifacts and add tests for property-ID remapping.

## Recommended Product Phasing

1. Phase A: Document current manual Markdown import path in the UI/docs as low-fidelity import.
2. Phase B: Implement API-driven JSON restore for pages, common blocks, compatible properties, local assets, and a restore manifest.
3. Phase C: Add data source restore with entry pages and relation second-pass mapping.
4. Phase D: Add optional comments best-effort recreation.
5. Phase E: Add view artifact backup and view-aware restore.

The practical recommendation is Phase B first if the product needs a real restore feature. Phase A is cheap and useful, but it should remain clearly labeled as low-fidelity import.

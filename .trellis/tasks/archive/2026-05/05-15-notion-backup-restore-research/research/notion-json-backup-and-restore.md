# Notion JSON Backup and Restore Research

Date: 2026-05-15

## Question

Why should the backup tool store Notion content as JSON first, and what is the realistic path for importing or restoring those backup artifacts back into Notion?

## Sources Reviewed

### Local Trellis and Code Sources

* Prior research: `.trellis/tasks/archive/2026-05/05-14-notion-backup-tool/research/notion-api-and-architecture.md`
* Prior PRD: `.trellis/tasks/archive/2026-05/05-14-notion-backup-tool/prd.md`
* Current backup writer: `src/server/backupWorker.ts`
* Current Chinese README backup data section: `README_CN.md`

### Official Notion Sources

* Create page: https://developers.notion.com/reference/post-page
* Append block children: https://developers.notion.com/reference/patch-block-children
* Retrieve page: https://developers.notion.com/reference/retrieve-a-page
* Page properties: https://developers.notion.com/reference/page-property-values
* Data source object: https://developers.notion.com/reference/data-source
* Query a data source: https://developers.notion.com/reference/query-a-data-source
* Create database: https://developers.notion.com/reference/create-database
* Create data source: https://developers.notion.com/reference/create-a-data-source
* Working with Markdown content: https://developers.notion.com/guides/data-apis/working-with-markdown-content
* File object: https://developers.notion.com/reference/file-object
* File Upload object/API: https://developers.notion.com/reference/file-upload
* Create a file upload: https://developers.notion.com/reference/create-file
* Send a file upload: https://developers.notion.com/reference/upload-file
* Complete a file upload: https://developers.notion.com/reference/complete-a-file-upload
* Import data into Notion: https://www.notion.com/help/import-data-into-notion

## Summary

JSON must remain the canonical backup format. Markdown is useful for people to inspect content and for low-fidelity manual import, but it does not carry enough structure to restore a Notion workspace reliably.

The current MVP does not provide restore/import. A future restore feature should be a best-effort API reconstruction that reads the JSON artifacts, creates new Notion objects, uploads local assets, and writes a restore manifest that maps old IDs to new IDs plus any warnings or skipped fields.

## Why JSON Is Canonical

1. Notion API objects are structured. Pages, page properties, block trees, comments, data source schemas, data source entries, file objects, parent pointers, timestamps, and error states are all JSON objects.
2. Page metadata and page content are separate API concerns. `Retrieve page` returns page properties, not content. Content requires block children or Markdown retrieval.
3. `Retrieve page` can truncate properties with many references. Complete backup needs page property item requests, which are structured JSON payloads.
4. Data sources require JSON schema and entry/page payloads. Markdown cannot represent data source property schemas, option IDs, relation metadata, rollups, formulas, or row/page identity in a useful restore format.
5. Asset handling needs structured metadata. Notion-hosted file URLs are temporary; local backups must download files during the run and record local paths plus skip/error details.
6. Restore needs stable machine-readable inputs. A future importer must map old IDs to new IDs, resolve relations in multiple passes, upload assets, and report per-item status. Markdown cannot support that workflow on its own.

## Markdown's Role

Markdown should be treated as a derived artifact:

* Good for reading backed-up pages outside Notion.
* Good for a quick manual import path through the Notion UI.
* Useful as a fallback when a user accepts lower fidelity.
* Not enough for canonical restore because unsupported blocks can become unknown markers, large or inaccessible subtrees can be truncated, and database/data source structure is not preserved.

The Notion Markdown API can read page content and can create/update page content from Notion-flavored Markdown. That is valuable for future fallback restore modes, but JSON should still drive any high-fidelity restore attempt.

## Current Artifact Contract

The current run layout is:

```text
BACKUP_ROOT/
`-- runs/
    `-- <run-key>/
        |-- manifest.json
        |-- logs.jsonl
        |-- pages/
        |   `-- <page-id>.json
        |-- data-sources/
        |   `-- <data-source-id>/
        |       |-- schema.json
        |       `-- entries.json
        |-- markdown/
        |   `-- <page-id>.md
        |-- assets/
        |   `-- <page-id>/
        |       `-- manifest.json
        `-- archive.zip
```

Current page JSON shape:

```json
{
  "page": {},
  "propertyItems": {},
  "blocks": [],
  "comments": null,
  "markdown": null
}
```

Current data source JSON shape:

* `schema.json`: the retrieved data source object and schema.
* `entries.json`: query results for the data source. Each entry is a page and is also backed up through the page backup path.

Current `manifest.json` tracks run status, partial/failure state, plan snapshot, selected items, per-item result/error metadata, and skipped file count.

## Immediate Import Path Today

The current tool can only support a low-fidelity manual path:

1. Download the backup run zip from the dashboard.
2. Unzip it locally.
3. Import files under `markdown/` into Notion through the product UI (`Settings` -> `Import` -> Markdown/Text, or the supported ZIP importer where available).

This path is acceptable for emergency access to page text, but it should not be described as restore. It will not reliably recreate data source schemas, relations, comments, original IDs, file attachments, permissions, page hierarchy, or unsupported blocks.

## Future Best-Effort Restore Flow

A future restore/import feature should be implemented as a separate workflow:

1. Preflight
   * Require a Notion token with read, insert content, and insert property capabilities as needed.
   * Ask the user for a target parent page or target data source/database.
   * Parse `manifest.json` and validate that required JSON artifacts exist.
   * Create an empty restore manifest with old-to-new ID maps, warnings, skipped fields, and per-item status.

2. Create target containers
   * For page backups, create a new page under the selected parent page.
   * For data source backups, create a new database with `initial_data_source` when restoring as a new database, or create an additional data source under an existing database when that is the selected target.
   * Use the backed-up data source schema as the source, but drop or transform read-only/computed fields that Notion will not accept.

3. Create pages and entries
   * For standalone pages, create target pages with compatible title/icon/cover/property data.
   * For data source entries, create pages under the restored target data source and set compatible properties.
   * Record every `oldPageId -> newPageId` and `oldDataSourceId -> newDataSourceId` mapping.

4. Restore blocks
   * Convert backed-up block JSON into create/append payloads.
   * Use `Append block children`, chunking requests to respect the 100-child request limit.
   * Recurse for deeper trees because a single append request supports only limited nesting.
   * Use the 2026-03-11 `position` object if insert ordering is needed.
   * Record unsupported block types instead of fabricating lossy equivalents without warning.

5. Restore assets
   * For local files under `assets/`, use the File Upload API: create upload, send file content, complete upload, then attach the resulting `file_upload` object to blocks/pages/properties.
   * For external URLs, reattach as external files if the user chooses not to mirror them.
   * If a local asset is missing, record the failure and continue according to the restore policy.

6. Resolve cross references
   * Run a second pass for relations, mentions, links to pages, and child-page references that depend on old-to-new ID mapping.
   * If a referenced object was not restored or is not accessible, leave the field unset and record a warning.

7. Verify and report
   * Write a restore manifest with target object IDs, skipped fields, errors, warnings, and partial/success status.
   * Never claim byte-for-byte or ID-preserving restoration.

## Restore Fidelity Limits

The restore feature can recreate content, not truly roll back Notion state. It cannot guarantee:

* Original Notion page/block/data source IDs.
* Original URLs based on those IDs.
* Edit history, created/last-edited identity, comments history, or resolved comments.
* Workspace permissions, sharing rules, or integration access state.
* Database/data source views and UI layout details that the API cannot manage.
* Read-only or computed values such as formulas, rollups, created time, created by, last edited time, and last edited by.
* Relations to pages that were not part of the restore set.
* Unsupported blocks or future Notion object types not accepted by current create APIs.

## Implementation Implications

* Keep writing page JSON even when Markdown retrieval succeeds.
* Keep Markdown generation best-effort and never promote it to source of truth.
* Preserve complete page property item payloads when possible.
* Preserve data source schema and entry/page JSON separately.
* Keep asset manifests and local file paths stable enough for future import tooling.
* If restore is implemented, add a new restore manifest instead of overloading backup `manifest.json`.
* UI copy should call Markdown import "manual low-fidelity import" and reserve "restore" for API-driven reconstruction with explicit limitations.

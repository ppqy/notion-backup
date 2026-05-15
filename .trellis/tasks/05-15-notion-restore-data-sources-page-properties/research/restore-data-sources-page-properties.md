# Restore Data Sources and Page Properties Research

Date: 2026-05-15

## Question

How should the existing restore flow extend from page/block recreation into data source schema, data source entries, and page property values?

## Inputs Reviewed

* `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-options/prd.md`
* `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-options/research/restore-options-to-notion.md`
* `.trellis/spec/backend/backup-artifacts-and-restore.md`
* `src/server/restore.ts`
* `src/server/restore.test.ts`
* `src/server/backupWorker.ts`
* `src/server/notionClient.ts`
* `node_modules/@notionhq/client/build/src/api-endpoints/*.d.ts`
* Official Notion docs: create database, create data source, create page, page property values.

## Findings

* Current restore already has the right report foundation: `mappings.dataSources`, item-level warnings, partial status, and canonical JSON reads.
* Current backup artifacts are enough for a first data source restore because `schema.json` contains property config and `entries.json` lists entry page IDs that also have page artifacts.
* Creating a database under the selected parent page is the practical container step because the target restore parent is a page. The SDK exposes `databases.create` with `initial_data_source`.
* Creating or updating standalone data sources also exists, but `dataSources.create` takes a database parent; it is better suited after a database container exists.
* Page creation accepts `parent.data_source_id`, so restored entry pages can be created directly inside the new data source once its ID is known.
* Page properties can be supplied during create. The implementation should build one conversion helper that can be used for both standalone pages and data source entries.
* Supported writable property values for this slice should include title, rich text, number, checkbox, select, multi-select, date, URL, email, phone number, status, place, and external file references.
* Read-only or computed values should warn and skip: formula outputs, rollup outputs, created/last-edited metadata, unique IDs, verification, and comments.
* Relations require an old-to-new page/data source mapping. They should be skipped with warnings unless both sides have been restored and the target data source exists.
* Notion-hosted/local file upload restoration remains out of scope. External file property values may be preserved if Notion accepts them.
* Current backups do not include view objects, so view restoration remains out of scope for this task.

## Implementation Direction

1. Add low-level Notion wrapper methods for database/data source creation.
2. Refactor page restore so `restorePageArtifact` can accept either a page parent or a data source parent.
3. Add schema conversion helpers that strip response-only data and keep supported property configuration.
4. Add page property conversion helpers that produce create/update-safe values and warnings.
5. Add data source restore flow:
   * read data source schema and entries
   * create database/data source under target parent
   * map old data source ID to new data source ID
   * create entry pages under the new data source
   * restore entry page blocks
6. Add a relation handling pass if mappings are available; otherwise warn.

## Risks

* The exact created database response may return a database with data source references instead of the full created data source object. The implementation should defensively extract the new data source ID from known response shapes and fail the item with a clear error if it cannot.
* Formula, rollup, relation, status, unique ID, and people schema behavior can be strict. The converter should skip doubtful fields rather than sending malformed payloads that fail the entire restore.
* Property names can collide or differ after Notion normalizes created schemas. Use names for the first slice, and record warnings for any property that cannot be written.


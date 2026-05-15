# Restore Notion Data Sources and Page Properties

## Goal

Continue the Notion restore work by restoring data source artifacts as new Notion data source/database content under the selected target parent, and by writing back supported page properties when restored pages are created.

## What I Already Know

* The previous restore MVP restores page JSON and common blocks into new Notion pages.
* The previous task intentionally skipped data source restore and non-title page property writes.
* Backup JSON remains canonical; Markdown is not a restore source when JSON artifacts exist.
* Current data source artifacts contain `data-sources/<id>/schema.json` and `entries.json`; each entry page is also backed up through `pages/<entry-id>.json`.
* Notion restore is best-effort recreation with new IDs, not rollback.
* The installed Notion SDK and current docs expose database creation with `initial_data_source`, data source creation/update, and page creation/update with property values.

## Assumptions

* The existing restore API and UI remain the entry point: `POST /api/runs/:id/restore` with a target parent page.
* A selected data source should restore as a new Notion database/data source under the target parent page.
* Entry pages should be created inside the restored data source using the new `data_source_id` parent.
* Standalone page restores under a page parent can restore only properties accepted by Notion for page-parent pages; database/data-source entry pages can restore richer data source properties.
* Relation and rollup restoration requires old-to-new data source/page mappings and may need a follow-up pass.

## Open Questions

* None for this slice. The user asked to proceed with data source plus page properties restore following the prior plan.

## Requirements

* Add Notion client support for creating databases/data sources as needed by the current API version.
* Restore successful `data_source` run items instead of skipping them.
* Read `schema.json`, `entries.json`, and referenced page artifacts from canonical JSON artifacts.
* Create a new database/data source under the selected target parent, preserving title, compatible icon, and supported property schema where possible.
* Record `oldDataSourceId -> newDataSourceId` in the restore report.
* Create entry pages under the new data source and restore their supported page properties and blocks.
* Restore supported page property values for pages when creating pages, including title, rich text, number, checkbox, select, multi-select, date, URL, email, phone number, status, place, and external file references where accepted.
* Skip or warn for read-only/computed/unsupported values such as formula values, rollups, created/edited metadata, unique IDs, verification, people that cannot be mapped, local file uploads, and unresolved relations.
* Add a best-effort relation pass only when both the source relation data source and related pages have old-to-new mappings; otherwise leave relation unset with warnings.
* Keep restore report warnings explicit and item status partial/failed when data source or property restore cannot be completed.
* Update frontend copy/report display only if new created data source/property information needs to be visible.

## Acceptance Criteria

* [x] A restore run with a successful selected data source creates a new Notion data source/database under the selected target parent.
* [x] The restore report records data source mappings and no longer emits `data_source_restore_not_implemented` for supported data source artifacts.
* [x] Entry pages from `entries.json` are recreated inside the restored data source, using their backed-up page artifacts for properties and blocks.
* [x] Supported data source schema properties are converted into create requests; unsupported schema properties are warned by property name/type.
* [x] Supported page property values are included when creating restored pages or entry pages.
* [x] Read-only/computed properties, unresolved relations, local file properties, comments, and unsupported values produce warnings rather than silent loss.
* [x] Existing page/block restore behavior remains covered and working.
* [x] Targeted restore unit tests cover data source schema conversion, page property conversion, relation warning/mapping behavior, and status resolution.
* [x] `npm run lint`, `npm run build`, and targeted Vitest tests pass.

## Definition of Done

* Requirements are captured in this PRD.
* Relevant restore contracts/specs are updated if behavior changes.
* Implementation has focused tests for conversion and restore report behavior.
* Quality checks pass.
* Work is committed through the Trellis Phase 3 flow.

## Out of Scope

* Live integration testing against a real Notion workspace.
* Full-fidelity restoration of views, templates, comments, permissions, edit history, original URLs, original IDs, or authorship/timestamps.
* Uploading local files through Notion's file upload API.
* Restoring arbitrary UI-only data source view state from current backups, because current artifacts do not include view objects.
* Guaranteeing relation restoration when the related target page/data source was not restored in the same restore run.

## Technical Notes

* Prior PRD: `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-options/prd.md`
* Prior research: `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-options/research/restore-options-to-notion.md`
* Restore implementation: `src/server/restore.ts`
* Restore tests: `src/server/restore.test.ts`
* Notion client wrapper: `src/server/notionClient.ts`
* Artifact contract: `.trellis/spec/backend/backup-artifacts-and-restore.md`
* Current Notion API version in app: `2026-03-11`

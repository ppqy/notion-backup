# Restore Data Source View Artifacts

## Goal

Add the next model-first restore slice: capture Notion data source view artifacts during backup so future view-aware restore has real source data to work from instead of inferring views from schema.

## What I Already Know

* The previous "Restore Model Evolution Foundation" task added manifest schema metadata, restore options persistence, extensible restore summaries, and future-safe mapping buckets.
* The backend restore spec marks view-aware backup/restore and property/view mapping as P0 model-first gaps.
* Current backup runs write data source schema and entries, but not data source view objects.
* Current manifest constants already include `data_source_views`, but new runs intentionally do not claim that capability until artifacts are actually written.
* The installed `@notionhq/client` exposes `client.views.list` and `client.views.retrieve`, and the project also has a raw `NotionClient.request` wrapper if needed.
* Notion's current Views API supports listing views by `data_source_id` and retrieving each full view object.

## Assumptions

* This task should back up view artifacts first; it should not implement view restore in the same slice.
* View backup should be automatic for backed-up data sources, not a new user-facing toggle.
* The artifact path should follow the existing spec recommendation: `data-sources/<data-source-id>/views.json`.
* View retrieval failures should be visible through logs/item metadata and should not silently claim full view support.
* The restore API should continue rejecting `restoreViews: true` until actual restore support is implemented.

## Open Questions

* None. User confirmed the recommended scope on 2026-05-15: implement backup-time view artifact capture only, with manifest capability updates and tests, while leaving view restore for the next task.

## Requirements

* Add Notion client methods for listing all views for a data source and retrieving full view objects.
* During data source backup, write `data-sources/<data-source-id>/views.json` containing enough raw Notion view data for future restore.
* Update manifest metadata so new backup runs claim `data_source_views` only when the backup implementation writes those artifacts.
* Preserve raw property IDs/names inside view objects for later property ID remapping.
* Record a visible warning or partial failure when view artifact retrieval fails, according to the existing backup failure style.
* Keep existing page-only backups and legacy restore behavior backward-compatible.
* Keep `restoreViews: true` unsupported for now; this task should not start creating Notion views.

## Acceptance Criteria

* [x] A data source backup writes `data-sources/<data-source-id>/views.json`.
* [x] New backup manifests include `data_source_views` in `capabilities` and `artifactKinds` only after view artifacts are part of backup output.
* [x] Page-only behavior remains unchanged.
* [x] Tests cover view artifact writing, manifest capability behavior, and view retrieval failure visibility/backward compatibility.
* [x] Existing restore validation still rejects `restoreViews: true`.
* [x] `npm run lint`, `npm test`, and `npm run build` pass.

## Definition of Done

* Requirements are confirmed before implementation starts.
* Backend backup and manifest behavior are updated with targeted tests.
* Backend restore spec is updated if artifact shape or capability contracts are sharpened.
* Quality checks pass.

## Out of Scope

* Creating/restoring Notion views during restore.
* Property ID remapping during restore execution.
* Relation second-pass repair.
* Comment recreation.
* External URL import mode.
* Multipart file upload support.
* New frontend controls for view restore.
* Live Notion workspace integration testing.

## Technical Approach

* Add `NotionClient` view helpers using the SDK `views` endpoints where possible.
* Extend `BackupWorker.backupDataSource` to capture view artifacts before or after schema/entries are written.
* Write raw view objects under the data source artifact directory, likely as `{ dataSourceId, views: [...] }` plus any warnings if needed.
* Update `backupManifestMetadataForPlan` or the run manifest construction so manifest claims match actual artifact output.
* Add tests around pure helpers where possible; add small seams if needed to keep `BackupWorker` behavior testable without live Notion calls.

## Research References

* Notion working with views guide: https://developers.notion.com/guides/data-apis/working-with-views
* Notion list views reference: https://developers.notion.com/reference/list-views
* Local research note: `.trellis/tasks/05-15-restore-data-source-view-artifacts/research/notion-views-api.md`
* Backend restore spec: `.trellis/spec/backend/backup-artifacts-and-restore.md`
* Previous foundation task: `.trellis/tasks/archive/2026-05/05-15-restore-model-evolution-foundation/prd.md`

## Technical Notes

* Likely backend files: `src/server/notionClient.ts`, `src/server/backupWorker.ts`, `src/server/backupManifest.ts`, `src/server/backupManifest.test.ts`.
* Likely shared files: `src/shared/constants.ts`, `src/shared/types.ts` only if artifact contracts need new explicit typing.
* Current SDK type notes: `ListDatabaseViewsParameters` accepts `data_source_id`; list results are view references, so full backup likely needs retrieve calls per view ID.

# Restore Data Source Views

## Goal

Implement the next restore slice: when a backup includes `data-sources/<data-source-id>/views.json`, allow restore jobs to optionally recreate Notion data source views for newly restored data sources.

## What I Already Know

* The previous task completed backup-time view artifact capture and archived cleanly.
* There is no active task and the working tree was clean before this task started.
* Backup artifacts now include `views.json` for selected data sources, and manifests claim `data_source_views` for data source backup plans.
* Current restore model already has `RestoreOptions.restoreViews`, `summary` metrics, and `mappings.views`, but validation rejects `restoreViews: true`.
* Current restore creates a new Notion database/data source, then restores data source entries as pages.
* The Notion SDK exposes `views.create`, and the current public API supports `POST /views` with `database_id`, `data_source_id`, view `name`, `type`, optional `filter`, `sorts`, `quick_filters`, and `configuration`.

## Assumptions

* View restore should be opt-in through the existing `restoreViews` option.
* The existing dashboard should expose the option so users can trigger it without hand-crafting API requests.
* View restore should run only after the target data source is created, because it needs the new database/data source IDs and property IDs.
* Restore must remain best-effort: unsupported or unmappable view fields become warnings, not silent fake success.
* This task should not implement comment restore, external URL import mode, relation second-pass repair, or live Notion integration tests.

## Open Questions

* None. The user asked to confirm that the previous view backup task is done and proceed with view backup restore if so.

## Requirements

* Stop rejecting `restoreViews: true`, while continuing to reject unimplemented `restoreComments` and `importExternalUrls`.
* Preflight should gate view restore on manifest capability `data_source_views` and presence of each selected data source's `views.json`.
* Restore should recreate views only for restored data source items whose view artifact is present and readable.
* Restore should create views with remapped target database ID, data source ID, and property IDs where the original view references data source properties.
* Restore report should record view old-to-new mappings and a `createdViews` summary metric.
* Missing/failed/partial view artifacts, unknown view types, failed Notion view creates, and missing property mappings should produce warnings.
* If `restoreViews` is false, existing restore behavior should remain unchanged except existing reports can still safely default mapping/summary fields.
* Add focused backend tests for view payload conversion, preflight gating, validation, and report metrics.
* Add a frontend restore option that sends `restoreViews` to preflight and restore enqueue.

## Acceptance Criteria

* [x] API validation accepts `{ options: { restoreViews: true } }` and still rejects other unimplemented options.
* [x] Preflight warns when view restore is requested but backup manifest/artifacts do not support it.
* [x] Data source restore creates Notion views from `views.json` when requested and records `mappings.views`.
* [x] View payload conversion remaps property IDs and warns/skips configuration that cannot be safely mapped.
* [x] Restore reports include `summary.createdViews`.
* [x] Dashboard can opt into view restore and passes the option to preflight/restore.
* [x] `npm run lint`, `npm test`, and `npm run build` pass.

## Definition of Done

* Requirements are persisted before implementation starts.
* Relevant backend/frontend specs are read before coding.
* Code, tests, and UI/API type usage are updated consistently.
* Quality gate passes or any blocker is recorded clearly.
* Spec updates are considered before wrap-up.

## Out of Scope

* Comment recreation.
* External URL import mode.
* Relation second-pass repair beyond existing mapped-only property behavior.
* Database/data source templates.
* Dashboard/form/dashboard widget view fidelity beyond best-effort warnings.
* Live Notion workspace integration testing.

## Technical Notes

* Likely backend files: `src/server/restore.ts`, `src/server/notionClient.ts`, `src/server/validation.ts`, `src/server/restore.test.ts`, `src/server/validation.test.ts`.
* Likely frontend files: `src/client/api.ts`, `src/client/main.tsx`, maybe `src/client/styles.css`.
* Existing artifact type: `DataSourceViewsArtifact` in `src/server/backupWorker.ts`.
* Existing spec anchors: `.trellis/spec/backend/backup-artifacts-and-restore.md` scenarios for data source view artifact backup and restore model evolution.
* Official API references checked on 2026-05-15:
  * https://developers.notion.com/reference/create-view
  * https://developers.notion.com/guides/data-apis/working-with-views

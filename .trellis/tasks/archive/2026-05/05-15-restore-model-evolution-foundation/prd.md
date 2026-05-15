# Restore Model Evolution Foundation

## Goal

Prepare the backup/restore data model for the next restore features before implementing model-sensitive behavior such as view restore, comment recreation, external URL import, or richer restore metrics.

## What I Already Know

* The latest backend restore spec classifies model-affecting restore work as P0 because old backups cannot support some future restore behavior unless artifacts and restore jobs are versioned first.
* Previous restore research concluded that JSON artifacts are canonical, Markdown is only a low-fidelity fallback, and restore must remain best-effort recreation with old-to-new mappings and warnings.
* Current backup manifests do not include `schemaVersion`, `capabilities`, or `artifactKinds`.
* Current restore history already has dedicated `restore_runs` / `restore_run_items`, preflight, progress, cancellation, and persisted restore manifests.
* Current `restore_runs` stores fixed dashboard counters but does not have `options_json`, `summary_json`, or `metrics_json`.
* Current restore enqueue accepts only `targetParent`; selected restore behavior is not persisted as an auditable option payload.
* Current `RestoreReport.mappings` includes `pages`, `blocks`, `dataSources`, and `files`; it does not yet expose `properties`, `views`, `databases`, or `comments` extension points.
* Current restore can still work for legacy backup runs whose manifest lacks schema metadata.

## Assumptions

* This first slice should build the model foundation and compatibility rules, not implement actual data source view backup/restore.
* A missing backup `schemaVersion` means legacy v1.
* The first explicitly versioned manifest should be treated as a new version, with capability metadata describing what artifacts are actually available.
* Restore options should be stored even when the current UI exposes only the target parent; unsupported future options should not silently imply working behavior.
* Fixed restore counters can remain for current dashboard performance, while a nullable JSON summary/metrics field preserves future counts without repeated one-column-per-feature migrations.

## Requirements

* Add a typed backup manifest contract that writes `schemaVersion`, `capabilities`, and `artifactKinds` for newly created backup runs.
* Add manifest compatibility helpers so legacy manifests without `schemaVersion` are treated as v1 and missing capability/artifact arrays default safely.
* Add an additive restore DB migration with nullable JSON fields for selected restore options and extensible summary/metrics.
* Add a shared `RestoreOptions` model and persist the selected/default restore options when enqueuing a restore job.
* Include persisted restore options in the final restore manifest/report for auditability.
* Persist an extensible restore summary/metrics JSON payload alongside the existing fixed restore counter columns.
* Extend restore report mapping defaults to include future-safe buckets for property/view-oriented work, at minimum `properties` and `views`, while old manifest readers default missing buckets to empty objects.
* Update restore preflight/report readers to distinguish legacy missing capabilities from actual support for future artifacts, without breaking current page/data-source/file restore.
* Keep current restore behavior backward-compatible for the existing target-parent-only API request body.

## Acceptance Criteria

* [x] A new backup run writes a manifest with `schemaVersion`, `capabilities`, and `artifactKinds`.
* [x] A legacy manifest with no `schemaVersion` still passes current restore preflight for supported current artifacts and is treated as v1.
* [x] Restore enqueue stores options in `restore_runs.options_json` and the restore manifest includes the selected/default options.
* [x] Restore completion stores a JSON summary/metrics payload without removing existing fixed dashboard counters.
* [x] Restore report readers default missing future mapping/summary fields from old manifests to empty objects or zero values.
* [x] Future-only capabilities such as `data_source_views` are not claimed for existing/current artifacts.
* [x] Migration tests verify the new restore columns are additive, nullable, and preserve existing rows.
* [x] Targeted tests cover manifest compatibility, restore options persistence, summary persistence, and mapping default behavior.
* [x] `npm run lint`, `npm test`, and `npm run build` pass.

## Definition of Done

* Requirements are captured in this PRD and confirmed before implementation starts.
* Backend manifest, restore repository, shared DTO, validation, and restore report behavior are updated as needed.
* Tests cover migration compatibility and old manifest/report defaults.
* Relevant backend restore spec is updated if implementation adds or sharpens contracts beyond the current spec update.
* Quality checks pass.

## Out of Scope

* Actual data source view artifact backup.
* Actual view-aware restore or calls to Notion Views APIs.
* Best-effort comment recreation.
* External URL import mode.
* Multipart uploads for files larger than 20 MiB.
* File-backed page icon/cover uploads.
* New frontend controls for future restore options unless needed to keep existing restore UI functional.
* Live Notion workspace integration testing.

## Technical Approach

Implement this as a model-first slice:

* Backup manifest: introduce stable constants/types for manifest schema version, capabilities, and artifact kinds; write them from `BackupWorker`.
* Manifest compatibility: centralize manifest reading/defaulting so restore preflight and future features do not infer support from missing fields.
* Restore persistence: append a new migration for nullable `options_json` and `summary_json` on `restore_runs`; update repository row mapping without editing already-applied migrations.
* Restore options: add a `RestoreOptions` type with safe defaults, keep the existing `{ targetParent }` request body working, and persist defaults until future UI/API flags are intentionally enabled.
* Restore report compatibility: create/default report mappings through helper logic so old manifests lacking new buckets remain readable.

## Implementation Plan

* PR1: Add manifest schema/capability constants, write new backup metadata, and test legacy manifest defaults.
* PR2: Add restore options/summary migration plus repository/shared DTO mapping tests.
* PR3: Wire options and extensible mappings through restore enqueue/execution/report readers, then run lint, tests, and build.

## Research References

* `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-research/research/notion-json-backup-and-restore.md` - JSON restore direction and best-effort restore constraints.
* `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-options/research/restore-options-to-notion.md` - view restore requires backing up view artifacts first; JSON restore remains recommended.
* `.trellis/tasks/archive/2026-05/05-15-notion-restore-history-preflight/research/restore-run-model.md` - dedicated restore run model, progress, history, and cancellation design.
* `.trellis/spec/backend/backup-artifacts-and-restore.md` - current restore artifact contracts and model evolution priority.

## Technical Notes

* Likely backend files: `src/server/backupWorker.ts`, `src/server/db.ts`, `src/server/repositories/restoreRepository.ts`, `src/server/restore.ts`, `src/server/routes.ts`, `src/server/validation.ts`.
* Likely shared/frontend-facing types: `src/shared/types.ts`, possibly `src/client/api.ts` only if API shapes need explicit client typing changes.
* Relevant specs: `.trellis/spec/backend/index.md`, `.trellis/spec/backend/backup-artifacts-and-restore.md`, `.trellis/spec/backend/database-guidelines.md`, `.trellis/spec/backend/quality-guidelines.md`.
* Verification passed: `npm run lint`, `npm test`, `npm run build`.

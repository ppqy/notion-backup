# Brainstorm: Restore History, Progress, Cancellation, and Preflight

## Goal

Make restore a first-class workflow instead of a synchronous action inside backup run detail: users should be able to preflight a restore, start it as a background restore job, watch progress, cancel it cooperatively, and revisit restore history.

## What I Already Know

* The user agrees with P0 dry-run/preflight and prioritizes P1 restore task model, progress, cancellation, and restore history because the experience impact is higher.
* The user chose cancellation semantics that preserve already-created Notion content and record partial/canceled results instead of attempting cleanup/delete.
* The user also wants the current backup cancellation logic checked and fixed in the same implementation because it appears problematic.
* Existing restore already recreates pages, common blocks, data sources, entry pages, supported properties, and writes restore manifests.
* Current restore starts from backup history detail via `POST /api/runs/:id/restore` and runs synchronously.
* Current restore history is only the latest report loaded from run artifact files; there is no durable restore list/table in the dashboard.
* Existing backup runs already have a useful queue/history/cancel pattern in SQLite and a worker loop.

## Assumptions

* Restore history should be a top-level or clearly discoverable dashboard surface, not only hidden inside one backup run drawer.
* Restore jobs should be persisted in SQLite with source backup run, target parent, status, progress counters, warnings/errors, manifest path, and per-item results.
* Restore cancellation should be cooperative: it stops future work and writes a canceled report, but does not delete Notion objects already created.
* Dry-run/preflight should run before creating a write job and should not call Notion write APIs.
* Backup cancellation should also be cooperative but must not leave queued/cancel-requested runs stuck forever.

## Open Questions

* None.

## Requirements

* Add a dedicated restore run model instead of treating restore as a synchronous API call.
* Add a new top-level sidebar section named "恢复" for restore history, progress, and restore details.
* Add restore history list/detail APIs with pagination and enough filtering for practical use.
* Add restore progress fields for status, phase, current item, totals, created counts, warning/error counts, started/finished timestamps, and source backup run.
* Add cooperative restore cancellation for queued/running restore jobs.
* Audit and fix backup cancellation so queued cancellations resolve to `canceled` and running cancellations are observed at safe checkpoints during long backup work.
* Add dry-run/preflight API that validates target parent and artifacts, summarizes expected pages/data sources/items, and surfaces expected limitations before writes.
* Refactor existing restore execution so it can update persisted progress and reuse current JSON restore conversion/report behavior.
* Update frontend restore UX to enqueue a restore job, show progress/history, display reports, and support canceling running restores.

## Acceptance Criteria

* [x] A user can preflight a backup run restore with a target parent and see expected work plus warnings before creating Notion content.
* [x] Starting restore creates a queued restore job and returns immediately with a restore run ID.
* [x] Restore jobs continue in the background and update progress while the UI polls.
* [x] Restore history lists previous restore jobs, including source backup run, target parent, status, created counts, warning/error counts, and timestamps.
* [x] Restore detail shows per-item status and the final restore report/manifest when available.
* [x] Queued or running restore jobs can be canceled; already-created content is left in Notion and the report/status makes that explicit.
* [x] Queued backup runs canceled before worker claim do not remain stuck in `cancel_requested`.
* [x] Running backup runs observe cancellation during long page/data-source work at safe checkpoints and finish with a persisted canceled manifest/report.
* [x] Existing page/data source/property restore behavior remains covered and working.
* [x] Lint, type-check/build, and targeted tests pass.

## Definition of Done

* Tests added or updated for repository behavior, preflight behavior, status/progress transitions, cancellation, and API DTOs.
* `npm run lint`, `npm run build`, and targeted tests pass.
* Restore/backend specs updated if contracts change.
* Migration handles existing installations without losing current backup or restore manifest files.

## Out of Scope

* Local/Notion-hosted file upload restore.
* View artifact backup or view-aware restore.
* Best-effort comment recreation.
* Deleting Notion content created by a canceled restore.
* Rolling back or deleting backup artifacts already written by a canceled backup.
* Live integration testing against a real Notion workspace unless the user explicitly provides one.

## Research References

* [`research/restore-run-model.md`](research/restore-run-model.md) - recommends dedicated `restore_runs` / `restore_run_items` plus a background `RestoreWorker`.

## Technical Approach

Recommended direction: add a dedicated restore run model and worker.

* Database: add `restore_runs` and `restore_run_items` tables with indexes for source backup run, status, and created time.
* Backend: add restore repository helpers, refactor restore execution into a worker-compatible flow, and add preflight/list/detail/cancel endpoints.
* Frontend: add a new top-level "恢复" sidebar view for restore history/detail/progress, update backup run restore controls to preflight then enqueue, and poll restore progress.
* Manifest compatibility: keep writing restore manifests under the source backup run directory and store the manifest path on the restore run.

## Decision (ADR-lite)

**Context**: Restore history needs to be easier to find and monitor than the current backup-detail-only restore report.

**Decision**: Add restore history as a new top-level sidebar section named "恢复".

**Consequences**: The UI gains a dedicated workflow surface for restore jobs, progress, cancellation, and reports. Backup run detail can still provide the "start restore" entry point, but ongoing and completed restore jobs live in the restore section.

**Cancellation Decision**: Canceling restore or backup is cooperative and does not delete already-created Notion content or already-written backup artifacts. The system records a canceled/partial result and stops future work at safe checkpoints.

## Technical Notes

* Current restore service: `src/server/restore.ts`
* Current restore API: `src/server/routes.ts`
* Current backup queue model: `src/server/db.ts`, `src/server/repositories/runRepository.ts`, `src/server/backupWorker.ts`
* Current restore UI: `src/client/main.tsx`
* Current shared restore DTOs: `src/shared/types.ts`
* Prior restore research: `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-options/research/restore-options-to-notion.md`

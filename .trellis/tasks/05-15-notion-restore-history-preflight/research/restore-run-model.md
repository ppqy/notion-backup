# Restore Run Model Research

Date: 2026-05-15

## Question

How should restore history, restore progress, cancellation, and preflight fit into the current backup dashboard architecture?

## Inputs Reviewed

* Previous restore research: `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-options/research/restore-options-to-notion.md`
* Data source/property restore PRD: `.trellis/tasks/archive/2026-05/05-15-notion-restore-data-sources-page-properties/prd.md`
* Restore contract: `.trellis/spec/backend/backup-artifacts-and-restore.md`
* Existing restore implementation: `src/server/restore.ts`
* Current backup run model: `src/server/db.ts`, `src/server/repositories/runRepository.ts`, `src/server/backupWorker.ts`
* Current restore UI/API: `src/client/main.tsx`, `src/client/api.ts`, `src/server/routes.ts`

## Current State

* Backup runs already have a durable queue model: `backup_runs`, `backup_run_items`, status fields, current phase/item, processed/failed counters, cancel request timestamp, and history list.
* Restore currently runs synchronously through `POST /api/runs/:id/restore`.
* Restore progress is not persisted in SQLite. The UI only shows a busy spinner until the synchronous request returns.
* Restore history is limited to `restore-latest.json` / `restore-manifest.json` files under the source backup run directory. There is no paginated restore history list.
* Restore cancellation is not available once the synchronous request starts.
* The previous restore research explicitly recommended a dry-run/preflight API before writes and a separate restore run type/table rather than overloading backup runs.

## Backup Cancellation Findings

* `requestRunCancel` changes queued and running backup runs to `cancel_requested`.
* `claimNextQueuedRun` only claims rows where `status = 'queued'`. A queued run canceled before the worker claims it can remain stuck in `cancel_requested`, because no worker path turns it into `canceled`.
* `deleteRun` rejects `cancel_requested`, so a queued run stuck in `cancel_requested` cannot be deleted through the normal delete path.
* Running backup cancellation is only checked between top-level selected items. A large page, data source, block tree, asset download loop, or property retrieval loop can continue for a long time before cancellation is observed.
* The current cancellation behavior should be preserved as cooperative: keep any artifacts already written, write a canceled manifest when a run had started, and do not attempt rollback/delete of partial files.

## Options

### Option A: Keep synchronous restore and improve manifest display

Keep `POST /api/runs/:id/restore` synchronous, then add a list by reading restore manifests from disk.

Pros:

* Smallest backend change.
* Reuses existing restore report files.

Cons:

* Still no true progress or cancellation.
* File scanning is awkward for pagination/filtering.
* Restore history remains secondary to backup run details.
* Large restores can keep HTTP requests open too long.

Verdict: not recommended for the user's stated priority.

### Option B: Reuse `backup_runs` for restore jobs

Add restore jobs as another trigger/type inside `backup_runs`.

Pros:

* Reuses queue/status/cancel UI concepts.
* Fewer new tables.

Cons:

* Backup and restore have different source/target semantics.
* `plan_snapshot_json`, backup artifact fields, and backup item schema do not map cleanly to restore.
* Mixed backup/restore rows make filtering and future cleanup more fragile.

Verdict: tempting, but it pollutes a model that is currently backup-specific.

### Option C: Add dedicated `restore_runs` / `restore_run_items` and a `RestoreWorker`

Create a restore job when the user starts restore, persist target parent, source backup run, status, counters, errors, latest manifest path, and item rows. A background worker claims queued restore runs, updates progress, writes manifest/report, and honors cancellation.

Pros:

* Best fit for restore history as a first-class product surface.
* Allows progress polling, cancellation, pagination, filtering, and future retry/delete.
* Keeps backup and restore state models separate while reusing familiar status/UI patterns.
* Supports dry-run/preflight as a separate endpoint before creating a write job.

Cons:

* More schema/repository/workflow code.
* Existing `restoreRunToNotion` must be refactored into resumable progress-aware execution helpers.

Verdict: recommended.

## Recommended Approach

Implement Option C:

1. Add restore tables and shared restore DTOs.
2. Add a restore repository with create/list/detail/update/cancel helpers.
3. Add a `RestoreWorker` that claims queued restore runs and executes the current JSON restore flow with persisted progress.
4. Change start restore API to enqueue a restore job and return a restore run summary/detail, not block until completion.
5. Add restore list/history UI, restore detail/progress display, and cancel action.
6. Add preflight/dry-run API that validates target parent/artifacts and summarizes expected work/warnings before any write.
7. Fix backup cancellation so queued cancel requests become `canceled`, deletion is not blocked by stale `cancel_requested`, and long running work checks cancellation at safe checkpoints.

## Constraints

* Restore must continue reading canonical JSON artifacts, not Markdown.
* Restore must continue creating new Notion content and must not overwrite source Notion objects.
* Existing `RestoreReport` manifest shape should be preserved or extended so old reports remain useful.
* Restore cancellation can be cooperative: finish the current Notion API operation, stop before the next item/block chunk, write a canceled/partial report, and leave already-created Notion objects in place.

# Optimize Backup And Restore Warnings

## Goal

Reduce repeated warning noise in backup and restore flows when many pages or database entries produce the same class of warning, while preserving raw warning details for audit and debugging.

## What I Already Know

* Restore preflight and restore reports currently expose a flat `RestoreWarning[]`.
* The UI displays the first few warnings directly, then shows a remaining count.
* Large restore jobs can produce many repeated warnings for comments, relation properties, read-only properties, files, views, and unsupported rich text.
* Backup comment summaries already count warning codes internally, but this is not presented through a shared user-facing summary model.

## Requirements

* Add a grouped warning summary model that aggregates repeated warnings by stable warning category.
* Preserve the existing raw `warnings` arrays in restore preflight and restore reports.
* Use grouped summaries in restore preflight and restore report UI by default.
* Show counts and a small set of examples for each warning group.
* Keep informational notices, such as restore creating new content, out of the main warning noise where practical.
* Avoid schema-breaking behavior for older restore manifests by normalizing missing summary fields safely.
* Keep the implementation scoped to warning summarization and display, without changing restore semantics.

## Acceptance Criteria

* [ ] Restore preflight returns grouped warning summaries alongside raw warnings.
* [ ] Restore reports persist and normalize grouped warning summaries alongside raw warnings.
* [ ] Frontend preflight/report warning sections display grouped summaries rather than repeated flat warning rows.
* [ ] Raw warning count remains available and accurate for metrics.
* [ ] Unit tests cover aggregation behavior and backwards-compatible normalization.
* [ ] Relevant lint/typecheck/tests pass.

## Out Of Scope

* Removing raw warnings from restore manifests.
* Changing Notion restore behavior for comments, relations, files, blocks, or views.
* Implementing new file upload, relation restore, comment restore, or view restore capabilities.
* Reworking backup manifest schema beyond any small reusable summary helpers needed for this task.

## Technical Notes

* Primary files inspected:
  * `src/shared/types.ts`
  * `src/server/restore.ts`
  * `src/server/restoreReport.ts`
  * `src/server/backupWorker.ts`
  * `src/client/main.tsx`
* Current warning display points:
  * `RestorePreflightSummary`
  * `RestoreReportSummary`
* Current warning count is derived from `warnings.length`; this should remain unchanged.

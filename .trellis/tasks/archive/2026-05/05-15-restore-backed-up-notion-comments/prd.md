# Restore Backed-Up Notion Comments

## Goal

Implement the next restore slice: when a backup includes page comments, allow restore jobs to optionally recreate those comments as new Notion comments on restored pages or blocks where the API gives enough target context.

## What I Already Know

* The app already backs up page comments when a plan enables `includeComments`.
* Restore already supports pages, data sources, page properties, downloaded files, restore history, preflight, cancellation, and optional data source view restore.
* `RestoreOptions.restoreComments` existed before this task and is now enabled by the implementation.
* Restore reports already include `mappings.comments` and extensible summary metrics, so comment mappings/counts can be added without a DB migration.
* Comment restore is best-effort only. It cannot preserve original author, timestamp, resolved state, edit history, or discussion fidelity.
* View icons are not currently supported by the Notion Views API create payload, so they remain out of scope.
* Follow-up gap recorded: data source name-level icon restore is separate from database icon restore. The current implementation creates a database and sets database `icon/cover`, but does not patch the created data source's own `title/icon`.

## Assumptions

* Comment restore should be opt-in through the existing `restoreComments` option.
* Comments should be restored after target pages/blocks are created so old page/block IDs can be mapped to new IDs.
* Only comments with readable rich text and a targetable page or block reference should be recreated.
* Unsupported comment targets should warn and continue.
* The UI can expose a simple restore checkbox alongside the existing "restore views" option.

## Open Questions

* None. The user asked to proceed with best-effort comment restoration.

## Requirements

* Stop rejecting `restoreComments: true`, while continuing to reject unimplemented `importExternalUrls`.
* Preflight should warn when comment restore is requested but selected page artifacts have no backed-up comments.
* Restore should recreate backed-up comments only for pages/blocks restored in the same restore job.
* Restore should map old comment IDs to new comment IDs in `RestoreReport.mappings.comments` when Notion returns a new comment ID.
* Restore should increment `summary.createdComments`.
* Restore should preserve comment rich text content where possible, stripping response-only fields and downgrading unsupported mentions consistently with existing rich text restore behavior.
* Restore should warn for missing comment target mappings, unsupported comment shapes, Notion create failures, and missing created comment IDs.
* Cancellation checkpoints should run before comment creation work.
* Frontend restore controls should include an opt-in "restore comments" checkbox and send it to preflight/restore enqueue.

## Acceptance Criteria

* [x] API validation accepts `{ options: { restoreComments: true } }` and still rejects `importExternalUrls: true`.
* [x] Preflight surfaces comment restore warnings for missing or unsupported backed-up comments.
* [x] Restore creates Notion comments for backed-up comments with mapped page/block targets.
* [x] Restore reports include `summary.createdComments` and `mappings.comments`.
* [x] Unsupported/unmapped comments become restore warnings, not silent loss or whole-run failure.
* [x] Dashboard can opt into comment restore and passes the option to preflight/restore.
* [x] Targeted tests cover validation, preflight, comment conversion, mappings/metrics, and warning behavior.
* [ ] `npm run lint`, `npm test`, and `npm run build` pass.

## Definition of Done

* Requirements are persisted before implementation starts.
* Official Notion comment API constraints are recorded under `research/`.
* Backend/frontend specs are read before coding.
* Implementation has focused tests for conversion and restore report behavior.
* Quality checks pass.
* Spec updates are considered before wrap-up.

## Out of Scope

* Preserving original comment authors, timestamps, edit history, resolved state, or exact discussion threading.
* Restoring comments whose source target cannot be mapped to a restored page/block.
* View icon restore; Notion create-view payload does not currently expose an icon field.
* Data source name-level icon restore; recorded as a separate follow-up.
* External URL import mode.
* Live Notion workspace integration testing.

## Research References

* [`research/notion-comments-api.md`](research/notion-comments-api.md) - official comment API constraints for create/list behavior.

## Technical Notes

* Likely backend files: `src/server/restore.ts`, `src/server/notionClient.ts`, `src/server/validation.ts`, `src/server/restore.test.ts`, `src/server/validation.test.ts`.
* Likely frontend files: `src/client/main.tsx`.
* Existing comment backup: `src/server/backupWorker.ts` writes `comments` into page artifacts when `includeComments` is enabled.
* Existing restore warning before implementation: `comments_restore_not_implemented` in `src/server/restore.ts`.
* Existing DTO support: `RestoreOptions.restoreComments`, `RestoreReport.mappings.comments`, and extensible `RestoreReport.summary`.
* Relevant spec: `.trellis/spec/backend/backup-artifacts-and-restore.md`.

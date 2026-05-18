# Document backup and restore status

## Goal

Update the existing project README files so operators can understand what backup and restore can do today, what remains best-effort or unsupported, and where the durable Trellis record for future restore work lives.

## What I Already Know

* The user asked to create a new Trellis task for this documentation work.
* Restore is now broadly implemented across prior tasks: page JSON restore, data source and page property restore, restore job history/preflight/progress/cancellation, downloaded file upload restore, data source view backup/restore, and best-effort comment restore.
* The current README files describe backup artifacts but do not describe restore workflows, implemented restore fidelity, or restore limitations.
* The repo has both `README.md` and `README_CN.md`; they should stay synchronized.
* Existing restore contracts already document best-effort boundaries in `.trellis/spec/backend/backup-artifacts-and-restore.md`.

## Assumptions

* Update both English and Simplified Chinese README files.
* Keep the docs factual and concise: the README should explain user-facing capabilities and limitations, while task research should preserve the longer future backlog.
* No runtime behavior should change in this task.

## Open Questions

* None. The requested scope is clear enough to implement directly.

## Requirements

* Add restore capability coverage to `README.md` and `README_CN.md`.
* Document that restore creates new Notion content and does not overwrite, roll back, or preserve original IDs.
* Document implemented restore features:
  * top-level restore history/workflow
  * preflight validation
  * queued restore jobs with progress and cancellation
  * page/block restore from JSON artifacts
  * data source/schema/entry page restore where supported
  * supported page properties
  * downloaded Notion/local asset restore through Notion File Uploads
  * opt-in comment restore
  * opt-in data source view restore
  * restore manifest/report with mappings and warnings
* Document remaining limitations:
  * original IDs/URLs/history/permissions/authorship/timestamps are not preserved
  * external URL import mode is not implemented
  * multipart upload for files larger than 20 MiB is not implemented
  * file-backed page icons/covers and data source name-level icons are not restored
  * relation repair is mapped-only
  * unsupported/read-only/computed properties remain warnings/skips
  * comment attachments and exact comment history are not restored
  * live Notion integration test coverage remains a future hardening gap
* Add a Trellis research note capturing restore follow-up gaps for future work.

## Acceptance Criteria

* [x] `README.md` includes backup and restore capabilities plus restore limitations.
* [x] `README_CN.md` includes the same information in Chinese.
* [x] A task-local research artifact records future restore gaps and suggested priority.
* [x] No implementation files are changed unless needed for documentation accuracy.
* [x] `npm run lint`, `npm test`, and `npm run build` pass.

## Definition of Done

* Requirements are captured in this PRD.
* README changes are synchronized across English and Chinese docs.
* Restore gaps are preserved under task research for future planning.
* Quality checks pass.
* Spec update is considered before wrap-up.

## Out of Scope

* Implementing any new restore feature.
* Changing APIs, database schema, backup artifacts, or UI behavior.
* Running live Notion workspace integration tests.

## Technical Notes

* Primary docs: `README.md`, `README_CN.md`.
* Restore contract reference: `.trellis/spec/backend/backup-artifacts-and-restore.md`.
* Spec update judgment: no `.trellis/spec/` change is needed for this task because no runtime contract changed and the backend restore spec already records the relevant best-effort restore boundaries and future gaps. This task keeps the longer future backlog in `research/restore-gaps.md` and the user-facing summary in the README files.
* Verification: `git diff --check`, `npm run lint`, `npm test`, and `npm run build` passed on 2026-05-18.
* Prior restore task archive references:
  * `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-options/`
  * `.trellis/tasks/archive/2026-05/05-15-notion-restore-data-sources-page-properties/`
  * `.trellis/tasks/archive/2026-05/05-15-notion-restore-history-preflight/`
  * `.trellis/tasks/archive/2026-05/05-15-notion-restore-file-upload/`
  * `.trellis/tasks/archive/2026-05/05-15-restore-data-source-view-artifacts/`
  * `.trellis/tasks/archive/2026-05/05-15-restore-data-source-views/`
  * `.trellis/tasks/archive/2026-05/05-15-restore-backed-up-notion-comments/`

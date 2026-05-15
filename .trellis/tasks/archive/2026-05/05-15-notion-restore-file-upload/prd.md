# Restore backed-up files into Notion

## Goal

Close the highest-value remaining restore gap by restoring backed-up Notion/local files through Notion File Uploads when a backup already contains downloaded asset files.

## What I already know

* Previous restore work already supports page JSON restore, common blocks, data sources, page properties, restore history, preflight, progress, and cancellation.
* The repeated out-of-scope restore gaps are local/Notion file upload restore, comment recreation, and view artifact backup/restore.
* Existing backup plans can download Notion-hosted files and mirror external files into `assets/<page-id>/manifest.json`.
* Before this task, restore preserved external media URLs but skipped Notion-hosted/local files with `local_file_upload_not_implemented`, `file_upload_not_implemented`, or `file_property_upload_not_implemented` warnings.
* Notion File Uploads can attach an uploaded file by passing a `file_upload` file object to blocks, pages, and properties after upload status is `uploaded`.

## Priority Decision

* P0: Restore backed-up files/assets. This improves existing backup recoverability without changing backup format.
* P1: Best-effort comment recreation. It can create new comments, but cannot preserve author/time/history and is less central to recovery.
* P2: View-aware backup and restore. This requires adding view artifacts first, so old backups cannot benefit.

## Assumptions

* This slice should support single-part File Uploads for downloaded files at or below 20 MiB.
* Multipart upload, external URL import mode, page icon/cover file uploads, and live Notion integration testing remain separate follow-ups.
* If a needed asset manifest/file is missing, restore should warn and continue rather than fail the whole item.

## Requirements

* Add Notion client support for single-part File Upload lifecycle.
* Map original Notion-hosted file URLs in backed-up blocks/properties to downloaded asset files from `assets/<page-id>/manifest.json`.
* Restore media/file blocks with uploaded `file_upload` objects when a matching downloaded asset exists.
* Restore files page properties with uploaded `file_upload` objects when matching downloaded assets exist, while preserving current external URL behavior.
* Record `report.mappings.files[old-url-or-path] = newFileUploadId` for successful uploads.
* Reuse upload mappings so the same backed-up file is uploaded once per restore run.
* Keep clear warnings for missing asset manifests, skipped downloads, missing files, oversized files, and unsupported upload cases.
* Preserve cancellation checkpoints before upload work and before subsequent Notion write calls.

## Acceptance Criteria

* [x] Notion-hosted file/image/pdf/audio/video blocks backed by downloaded assets convert to `file_upload` payloads instead of being skipped.
* [x] Files properties backed by downloaded assets include `file_upload` values when creating restored entry pages.
* [x] Existing external media/file restore behavior remains unchanged.
* [x] Missing/skipped/oversized local assets generate restore warnings and do not silently disappear.
* [x] Restore reports include file upload ID mappings.
* [x] Targeted tests cover block conversion with asset lookup, property conversion with asset lookup, and missing asset warnings.
* [x] `npm run lint`, `npm test`, and `npm run build` pass.

## Definition of Done

* Requirements are captured in this PRD.
* Research notes are persisted under `research/`.
* Backend restore implementation and tests are updated.
* Relevant restore contracts/specs are updated if behavior changes.
* Quality checks pass.

## Out of Scope

* Multipart uploads for files larger than 20 MiB.
* Uploading file-backed page icons or covers.
* Importing arbitrary external URLs into Notion-hosted files during restore.
* Best-effort comment recreation.
* View artifact backup or view-aware restore.
* Live integration testing against a real Notion workspace.

## Technical Notes

* Restore implementation: `src/server/restore.ts`
* Notion wrapper: `src/server/notionClient.ts`
* Asset backup helpers: `src/server/assets.ts`, `src/server/backupWorker.ts`
* Restore tests: `src/server/restore.test.ts`
* Artifact contract: `.trellis/spec/backend/backup-artifacts-and-restore.md`
* Prior restore PRDs:
  * `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-options/prd.md`
  * `.trellis/tasks/archive/2026-05/05-15-notion-restore-data-sources-page-properties/prd.md`
  * `.trellis/tasks/archive/2026-05/05-15-notion-restore-history-preflight/prd.md`

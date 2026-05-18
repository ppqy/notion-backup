# Restore Gap Backlog

Date: 2026-05-18

## Purpose

Preserve the remaining restore gaps after the core backup/restore workflow reached a usable state. This file is task-local Trellis context for future implementation planning and README accuracy.

## Current Implemented Restore Coverage

* Restore is API-driven from canonical JSON artifacts, not Markdown.
* Restore creates new Notion content under a selected target parent and writes restore manifests/reports.
* Restore runs are durable background jobs with preflight, history, progress, report detail, and cooperative cancellation.
* Page restore supports common block conversion, recursive child page restore when artifacts exist, supported rich text, supported icons/covers, tables, media/file blocks, and explicit warnings for unsupported blocks.
* Data source restore creates new database/data source containers, restores supported schema fields, creates entry pages, restores supported page properties, and records old-to-new mappings.
* Downloaded Notion/local file assets can be restored with single-part Notion File Uploads when matching backup asset manifests exist and files are at or below 20 MiB.
* Comment restore is opt-in and best-effort. It can recreate text comments on mapped restored pages/blocks and record comment mappings.
* Data source view restore is opt-in and capability-gated. It uses backed-up `views.json`, remaps property IDs where possible, and records view mappings/metrics.

## Remaining Gaps

### P1: Product-visible restore behavior

* External URL import mode is not implemented. Existing restore preserves external URLs as external references; it does not fetch and upload arbitrary external URLs into Notion-hosted files.
* Relation strategy is only `mapped_only`. Relations are written only when the related source page has an old-to-new mapping in the same restore run.
* Live Notion workspace integration testing is still missing. Current tests cover conversion, validation, repositories, and restore report behavior, but not an end-to-end restore against a real workspace.

### P2: Asset and visual fidelity

* Multipart uploads for files larger than 20 MiB are not implemented.
* File-backed page icons and page covers are not restored through file upload.
* Data source name-level icons are not restored after database/data source creation.
* View icons are not restored because current Notion view creation payload support is limited.

### P2: Content fidelity

* Original Notion IDs, original Notion URLs, permissions, sharing rules, edit history, authorship, and timestamps cannot be preserved.
* Comment authors, timestamps, resolved state, exact discussion threading, and comment attachments are not restored.
* Unsupported block types are skipped with warnings.
* Rich text mentions that cannot be recreated are downgraded to text with warnings.
* Formula, rollup, relation schema, button, verification, last-visited, and other unsupported/read-only/computed data source or page properties are skipped or degraded with warnings.
* Relations to content that was not restored in the same run are left unset with warnings.

## Suggested Future Order

1. Add live Notion integration tests or a documented manual test checklist for restore, because this reduces release risk for all later restore work.
2. Implement external URL import mode behind explicit `RestoreOptions.importExternalUrls`.
3. Add multipart upload support for files over 20 MiB.
4. Improve visual asset fidelity for file-backed icons/covers and data source name-level icons.
5. Explore richer relation repair strategies beyond `mapped_only`.

## Source References

* `.trellis/spec/backend/backup-artifacts-and-restore.md`
* `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-options/research/restore-options-to-notion.md`
* `.trellis/tasks/archive/2026-05/05-15-notion-restore-file-upload/prd.md`
* `.trellis/tasks/archive/2026-05/05-15-restore-data-source-views/prd.md`
* `.trellis/tasks/archive/2026-05/05-15-restore-backed-up-notion-comments/prd.md`

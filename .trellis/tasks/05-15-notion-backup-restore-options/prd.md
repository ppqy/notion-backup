# Brainstorm: Notion Backup Restore Options

## Goal

Implement the first practical restore workflow for this tool: restore backed-up page JSON into new Notion pages under a user-selected target parent, generate a restore manifest/report, and keep data loss explicit through warnings.

## What I Already Know

* The current product is a self-hosted Notion backup dashboard with Chinese-first UI.
* Backup artifacts are written under `BACKUP_ROOT/runs/<run-key>/`.
* JSON artifacts are the canonical backup record; Markdown is derived helper output.
* Existing research already concluded that restore/import is best-effort recreation, not ID-preserving rollback.
* Current page artifacts contain `page`, `propertyItems`, recursive `blocks`, optional `comments`, and optional `markdown`.
* Current data source artifacts contain `schema.json` and `entries.json`; entry pages are also backed up as page artifacts.
* Current artifacts can support manual Markdown import today and a future API-driven restore, but no restore feature exists yet.

## Assumptions

* The next restore implementation should optimize for practical recovery and transparency over impossible full-fidelity claims.
* The first API restore should create new Notion objects under a user-selected target, not overwrite existing source objects.
* The first implementation should focus on page artifacts and common block types. Data source schema/entry restore, relation remapping, comments, views, and local file upload can follow in later phases.

## Open Questions

* None for this slice. The user approved starting with the recommended API-driven JSON restore path.

## Requirements

* Add backend restore execution that reads canonical `pages/<page-id>.json` artifacts from a backup run.
* Add restore preflight/validation for missing run, missing artifact directory, missing manifest, missing Notion token, missing target parent, and unsupported selected items.
* Create new Notion pages under a selected target parent page using compatible page title/icon/cover where possible.
* Convert backed-up common block JSON into Notion append children payloads and recurse through children.
* Degrade unsupported blocks/properties explicitly through restore warnings instead of silently pretending success.
* Write a restore manifest/report with restore ID, source run, target parent, status, old-to-new page/block mappings where available, item results, warnings, and errors.
* Expose restore APIs from the authenticated dashboard.
* Add frontend controls on backup run detail to enter a target parent page URL/ID, start restore, and display the latest restore report.
* Keep UI copy clear that restore creates new Notion content and does not roll back original pages.

## Acceptance Criteria

* [x] Research note compares restore options.
* [x] Recommendation is aligned with current artifact contracts.
* [x] Current Notion API capabilities are reflected with source links.
* [x] Spec is updated where prior restore boundary text was too broad or outdated.
* [x] A logged-in user can start a restore from a completed/partial backup run detail by entering a target Notion parent page URL/ID.
* [x] Restore reads JSON page artifacts, not Markdown, when recreating pages.
* [x] Restore writes a `restore-manifest.json` or equivalent restore report under the run artifact directory.
* [x] Unsupported data source restores, comments, relations, views, file uploads, unsupported block types, and unsupported properties are visible as warnings.
* [x] The UI displays restore status, target parent, created page count, warnings, and errors.
* [x] Type-check/build/tests pass for the changed surface.

## Definition of Done

* Research notes are written to task files.
* Restore implementation is covered by targeted tests for conversion/preflight behavior.
* Lint/type-check/build pass.
* Spec learning is captured for future sessions.

## Out of Scope

* Running live restore tests against a Notion workspace.
* Adding new dependencies.
* Restoring data source schemas/entries as structured databases in this first slice.
* Restoring relations, comments, views, original IDs, edit history, permissions, or exact computed/read-only values.
* Uploading local asset files in this first slice; file blocks/properties should warn or keep supported external references only.

## Technical Notes

* Prior restore research: `.trellis/tasks/archive/2026-05/05-15-notion-backup-restore-research/research/notion-json-backup-and-restore.md`
* Backup/restore spec: `.trellis/spec/backend/backup-artifacts-and-restore.md`
* Backup writer: `src/server/backupWorker.ts`
* Notion wrapper: `src/server/notionClient.ts`
* Current Notion API version in app: `2026-03-11`

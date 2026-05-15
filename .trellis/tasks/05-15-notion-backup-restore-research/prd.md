# Record Notion JSON Backup and Restore Research

## Goal

Persist the research conclusion that Notion backup artifacts should use JSON as the canonical format, with Markdown as a derived human-readable/import helper, and record the practical path and limits for importing or restoring backups into Notion.

## What I Already Know

* The prior archived Notion backup task established JSON-first backup fidelity and explicitly left restore/import workflows out of the MVP.
* The current implementation writes per-run artifacts under `BACKUP_ROOT/runs/<run-key>/` with `manifest.json`, page JSON, data source JSON, Markdown, assets, and logs.
* Page metadata, complete property items, block trees, comments, Markdown output, data source schemas, entries, and assets are structured API payloads that cannot be represented fully by Markdown alone.
* Notion-hosted file URLs expire, so durable backup requires local asset downloads when the plan enables them.
* Notion can import Markdown through the product UI, but it cannot directly import this backup JSON format.
* The Notion API supports enough creation primitives for a future best-effort restore, but that restore would create new Notion objects and cannot preserve original IDs, edit history, permissions, or every computed/read-only value.

## Assumptions

* This is a documentation/research capture task only; no application behavior changes are required.
* Restore/import remains out of scope for the current MVP.
* Future restore work should prefer API-driven reconstruction from JSON, using Markdown only as a fallback or human-readable helper.

## Open Questions

* None for this research capture.

## Requirements

* Add a task research artifact explaining why JSON is canonical for backups.
* Document the current artifact layout and how each artifact contributes to future restore.
* Document the immediate low-fidelity manual import path using Markdown.
* Document a future best-effort API restore outline and the explicit fidelity limits.
* Capture the decision in backend code-spec so future implementation work does not treat Markdown as the source of truth.
* Curate Trellis context files for this task.

## Acceptance Criteria

* [x] `research/notion-json-backup-and-restore.md` exists and covers JSON, Markdown, assets, restore flow, and limitations.
* [x] Backend spec records the JSON-canonical artifact contract and restore boundary.
* [x] `implement.jsonl` and `check.jsonl` reference the relevant spec/research files.
* [x] No application code behavior is changed.

## Definition of Done

* Research notes are written to task files.
* Spec learning is captured for future implementation work.
* Markdown changes pass a basic diff/whitespace review.
* Git status is inspected and a Trellis commit plan is presented.

## Out of Scope

* Implementing restore/import UI.
* Implementing restore/import API endpoints or scripts.
* Changing backup artifact generation.
* Adding CSV export or Notion product importer integration.

## Technical Notes

* Prior research: `.trellis/tasks/archive/2026-05/05-14-notion-backup-tool/research/notion-api-and-architecture.md`
* Prior PRD: `.trellis/tasks/archive/2026-05/05-14-notion-backup-tool/prd.md`
* Current backup writer: `src/server/backupWorker.ts`
* Current public artifact docs: `README_CN.md`

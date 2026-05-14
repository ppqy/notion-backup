# Brainstorm: Notion Backup Tool

## Goal

Build a self-hosted Notion backup tool that lets a user configure a Notion integration token, browse the content that token can access, select pages/databases to back up, run manual backups, schedule automatic backups, and inspect historical backup records. The app should be deployable with Docker.

## What I Already Know

* The repository is currently a Trellis scaffold with no application code yet.
* The desired product has a frontend admin panel.
* The panel must allow configuring a Notion token.
* After a token is configured, the app must discover content accessible to that token.
* The user must be able to select which pages/databases are included in backups.
* The app must support manual backups.
* The app must support scheduled automatic backups.
* The panel must show historical backup records.
* Each backup record must show which pages, databases, and related content were backed up.
* The deployment target is Docker.
* Technical stack should be chosen after research, including official recommendations where available.
* Official Notion API docs currently target API version `2026-03-11`.
* Notion's newer API model uses `data_sources` for database-like queryable content.
* Notion search is useful for discovery but is not guaranteed to enumerate every accessible page/data source.
* The official Notion JavaScript SDK supports TypeScript and `notionVersion`.

## Assumptions (Temporary)

* This is intended as a private/self-hosted single-user or small-team service, not a public SaaS.
* The MVP will use a Notion internal integration token, not OAuth.
* The MVP will use a single administrator account for dashboard access.
* First-run setup should guide the user through administrator creation, encryption key awareness, optional Notion token setup, and optional first backup plan creation.
* The first version can store backup artifacts on local Docker volumes.
* Backup fidelity should prefer machine-readable JSON first; Notion-flavored Markdown can be generated as a human-readable artifact.
* Backups should download Notion-hosted files by default because their API URLs expire.
* External file URLs should be recorded by default and mirrored only when the backup plan enables it.
* Backup artifacts should preserve enough structure for a future best-effort re-import, but the MVP will not provide restore/import UI or API.

## Open Questions

* None currently.

## Requirements (Evolving)

* Provide a web dashboard for token setup, content discovery, backup selection, schedule settings, and backup history.
* Provide a lightweight dashboard overview as the authenticated landing page.
* Dashboard overview should show Notion token status, plan count, enabled schedule count, latest backup status, currently running backups, backup storage usage, and quick actions.
* Frontend user-facing copy should be Chinese-first for the MVP.
* Code identifiers, API fields, database columns, and technical docs should remain English.
* Protect the dashboard and API with a single administrator login.
* Provide a Notion settings page for token management, validation, and content refresh.
* Provide an app/security settings area for changing the administrator password.
* Changing the administrator password should require the current password.
* Show a first-run setup wizard when no administrator exists in the database.
* The setup wizard must require administrator username/password creation as step 1.
* After administrator creation, require an authenticated session before continuing setup.
* Use `APP_ENCRYPTION_KEY` from the environment when provided.
* If no `APP_ENCRYPTION_KEY` is provided, generate a stable encryption key and persist it under the Docker data volume.
* The setup wizard must include a security/key step after administrator creation.
* If the key was auto-generated, show it once in setup with copy/save guidance and explain that losing it requires re-entering encrypted secrets such as the Notion token.
* If the key comes from the environment, show that encryption is configured without revealing the key.
* After setup, do not show encryption key status in the main dashboard.
* Setup step 3 should optionally configure and validate the Notion token.
* Setup step 4 should be available only when a valid Notion token has been configured and content discovery context exists.
* If the user skips token setup, setup should finish and enter the dashboard instead of showing first backup plan creation.
* Setup step 4 should optionally create the first backup plan.
* Setup should allow skipping token setup and entering the dashboard in an empty Notion connection state.
* When no token is configured, the dashboard should show a Notion connection empty state and setup/settings entry point.
* Disable the setup wizard after an administrator account exists.
* Use httpOnly cookie sessions after login.
* Persist token/configuration securely enough for a self-hosted Docker deployment.
* Notion token must validate successfully before being saved.
* Invalid or temporarily unverifiable Notion tokens should not be saved.
* Provide a clear Notion token action.
* Clearing the Notion token should preserve backup plans but prevent manual runs and schedule enablement until a valid token is saved.
* Clearing the Notion token should clear discovered content cache and connection identity snapshot.
* Use the Notion API to enumerate content that the configured token can access.
* Allow selecting pages and data sources/databases for inclusion.
* Content selection should support title search and type filters for cached discovered content.
* Content selection rows should show title, type, parent metadata when available, last edited time, and selected state.
* Content selection should use a flat list with parent metadata in the MVP.
* Manual add by URL/ID should be visible from the content selection UI.
* Allow manual add by Notion URL/ID when search does not return expected content.
* Manual add should parse Notion URLs/IDs, normalize object IDs, validate access/type immediately through the Notion API, and store successful objects in the local discovery cache.
* Manual add validation errors should distinguish invalid format, not found, no access, and unsupported object type where practical.
* Cache discovered Notion content in SQLite.
* Show last refreshed time for discovered content.
* Provide manual refresh of discovered content.
* Automatically refresh discovered content after saving/changing a Notion token.
* Automatically refresh discovered content during setup after a Notion token is configured.
* Automatically refresh discovered content when opening content selection if the cache is empty.
* Changing the Notion token should clear the old discovery cache and automatically refresh content with the new token.
* Existing backup plans should be preserved when the token changes, but selected content must be validated before manual run or schedule enablement.
* Token validation should store a Notion connection identity snapshot when available, such as workspace/bot/user information and validation time.
* The UI should show connection identity/status and last validation time, but never show the saved token value.
* Avoid frequent background discovery refreshes in the MVP to respect Notion API rate limits.
* Before executing a backup run, refresh metadata for selected pages/data sources live from Notion.
* Discovery cache is for selection UX only and should not be treated as the source of truth for backup execution.
* Selecting a data source should back up its schema and all queryable entries/pages.
* Data source entries/pages should include both properties and page content blocks by default.
* Data source entry page content should follow the same asset, comments, child page, and deduplication policies where applicable.
* The MVP should not include Notion data source row filters.
* Missing, inaccessible, or item-level Notion failures should mark that item failed and continue backing up remaining selected items.
* Global failures such as invalid token, database write failure, backup directory write failure, or unrecoverable configuration errors should fail the whole run.
* Retry transient Notion/API/network failures before marking an item failed.
* Handle Notion `429` by honoring `Retry-After`.
* Retry network timeouts and 5xx responses with exponential backoff.
* Do not retry expected authorization/not-found errors such as 401, 403, and 404.
* Write retry attempts and final error outcomes to per-run logs.
* Execute backups manually and on a schedule.
* Allow canceling an in-progress backup run.
* Cancellation should be cooperative: the UI marks the run as cancel requested, and the worker stops at safe checkpoints.
* Canceled runs should keep already-written artifacts and mark the manifest/history as partial.
* Support multiple backup plans in the MVP.
* Each backup plan should own its selected Notion content, schedule preset or cron expression, timezone, enabled/disabled state, and asset download policy.
* Each backup plan should expose asset download settings clearly in the UI.
* Each backup plan should include a comments backup toggle, defaulting to off.
* When enabled, back up comments that the Notion API can read.
* The UI should explain that resolved comments or inaccessible comments may not be available through the API.
* Each backup plan should include a child page inclusion toggle for selected pages, defaulting to on.
* When enabled, selected pages should recursively include child pages discovered through page content.
* The backup worker should deduplicate page IDs so a page selected or discovered through multiple paths is backed up once per run.
* Notion-hosted files should be downloaded by default.
* External URL assets should not be mirrored by default.
* Each backup plan should have a configurable per-file download size limit, defaulting to 100 MB.
* Users should be able to change or disable the per-file download size limit.
* The plan UI should explain that files above the limit will be skipped and recorded in the backup result.
* The MVP should not include a per-run total asset size limit.
* Manual backups should run from an existing backup plan, not from ad hoc one-off selections.
* Backup plan auto-scheduling should be disabled by default when creating a plan.
* The create/edit plan form should include an enable/disable schedule toggle, defaulting to disabled.
* A plan can be saved before all fields are complete.
* If the user chooses enabled scheduling while required fields are incomplete, save the plan with scheduling disabled and show a validation message explaining what is missing.
* Manual run validation should require a configured Notion token and at least one selected page/data source, but should not require a schedule.
* Enabling scheduling should require a configured Notion token, at least one selected page/data source, and a valid schedule/timezone.
* Attempting to manually run or enable an incomplete plan should show a focused prompt listing missing requirements.
* Plans with enabled scheduling can be disabled and re-enabled.
* Deleting a backup plan should always soft-delete it, even when it has no history.
* Soft-deleted plans should not appear in default plan lists and should never run on a schedule.
* Soft-deleted plans should not be restorable in the MVP.
* Backup run history should remain visible after a plan is deleted and should display a plan snapshot/name captured at run time.
* Deleting a plan should not delete backup history or artifact files.
* Schedule UI should offer common presets and an advanced cron expression field.
* Schedule UI should show the next run time for enabled plans.
* Backup plan list should sort newest first by creation time by default.
* Backup plan list should support filtering by status.
* Backup plan list should support searching by plan name.
* Record every backup run with trigger type, timestamps, status, selected content, and result metadata.
* Show live-ish backup progress with HTTP polling on the history/detail screens.
* Progress should include current phase, processed count, failed count, total count when known, and current item title when available.
* Backup history list should show plan, trigger type, status, start/end time, duration, object counts, artifact size, and error summary.
* Backup history list should use simple page/pageSize pagination.
* Backup history list should sort newest first by run creation/start time by default.
* Backup history list should support filtering by plan, status, trigger type, and date range.
* Backup history list should support search by run title/plan name where available.
* Backup history detail should show backed up pages/data sources with per-item status, error details, and artifact paths.
* The frontend should not render full backed up JSON/Markdown content inline in the MVP.
* Provide artifact download links from backup history.
* Provide direct `manifest.json` download per backup run.
* Provide whole-run `.zip` download per backup run.
* Generate whole-run zip archives on demand when first downloaded.
* Cache generated zip archives inside the run artifact directory for later downloads.
* Delete cached zip archives when the backup run is deleted.
* Do not implement a generic backup artifact file browser in the MVP.
* Provide a Docker-based deployment path.
* Expose an unauthenticated `GET /healthz` endpoint for Docker health checks.
* `/healthz` should report only basic app/database health and must not expose secrets, backup content, or setup/config details.
* Product/admin operations should be performed through the web UI in the MVP.
* Use a durable database for configuration, schedules, backup history, and worker progress.
* Store backup artifacts outside the database on a mounted volume.
* Default to SQLite for MVP metadata storage to keep Docker deployment lightweight.
* Download Notion-hosted files into the backup artifact by default, with size limits and per-plan controls.
* Preserve file metadata and local asset paths in backup manifests.
* Files skipped due to size limits should not fail the whole run; they should be recorded as skipped with clear reasons.
* Store each backup run under `/data/backups/runs/<run-id>/`.
* Use human-readable run IDs in the form `<timestamp>_<short-id>`.
* Each run artifact directory should contain `manifest.json`, `pages/`, `data-sources/`, `markdown/`, `assets/`, and `logs.jsonl`.
* Each backup run should write per-run structured logs to `logs.jsonl`.
* The frontend should expose per-run log summaries/links but not full application log downloads.
* General application logs should be handled through Docker logs.
* Keep backup runs indefinitely by default.
* Allow manual deletion of a backup run and its artifact files.
* Deleting a backup run should be permanent and require confirmation.
* Backup run deletion should remove database run/item records and the corresponding `/data/backups/runs/<run-id>/` directory.
* If artifact deletion fails, keep the database history record and surface the deletion error.
* Successful, failed, and canceled backup runs can be deleted.
* Running backup runs cannot be deleted; the user must cancel them first.
* Queued backup runs cannot be deleted directly; the user must cancel them first.

## Acceptance Criteria (Evolving)

* [ ] A user must log in as the administrator before accessing the dashboard or API.
* [ ] On a fresh deployment with no administrator configured, a user sees a first-run setup wizard.
* [ ] The first-run setup wizard requires administrator username/password creation.
* [ ] After administrator creation, setup continues only under an authenticated session.
* [ ] The first-run setup wizard explains the encryption key state and gives one chance to copy/save an auto-generated key.
* [ ] The first-run setup wizard lets the user skip Notion token setup.
* [ ] Skipping token setup lands the user in the dashboard with a clear Notion connection empty state.
* [ ] First backup plan setup is shown only after a valid Notion token is configured.
* [ ] The first-run setup wizard lets the user skip first backup plan creation.
* [ ] The setup wizard is inaccessible after an administrator account exists.
* [ ] A logged-in user can log out.
* [ ] A logged-in administrator can change the administrator password after entering the current password.
* [ ] A user can save a Notion token in the panel.
* [ ] Invalid Notion tokens are not saved.
* [ ] A user can clear the Notion token; plans remain but cannot run until a valid token exists.
* [ ] Clearing the Notion token clears discovered content cache and connection identity state.
* [ ] After token validation, the UI shows connection identity/status and last validation time without revealing the token.
* [ ] The MVP dashboard uses Chinese user-facing labels and messages.
* [ ] The authenticated landing page shows a lightweight backup overview and quick actions.
* [ ] A user can refresh and view pages/data sources returned by Notion search for the token.
* [ ] Discovered content is cached locally with last refreshed time.
* [ ] Content discovery refreshes automatically when a token is saved/changed and when selection opens with an empty cache.
* [ ] Changing the Notion token clears stale discovery cache and refreshes with the new token.
* [ ] A user can manually add a Notion page/data source by URL or ID.
* [ ] Manual add validates and normalizes Notion URLs/IDs before storing them.
* [ ] Backup execution refreshes selected object metadata from Notion before writing artifacts.
* [ ] Data source backups include schema, all queryable entry properties, and entry page content blocks.
* [ ] A user can select content to back up.
* [ ] Content selection supports title search and page/data source filtering.
* [ ] Content selection uses a flat list rather than a hierarchical tree in the MVP.
* [ ] A user can create, edit, enable, disable, and delete multiple backup plans.
* [ ] Backup plan list defaults to creation time descending and supports status filtering.
* [ ] Backup plan list supports plan name search.
* [ ] Backup plan scheduling is disabled by default during creation.
* [ ] A user can save an incomplete backup plan.
* [ ] A user can manually run a plan without a configured schedule when token and content selection are valid.
* [ ] Attempting to manually run a plan without required manual-run fields shows a prompt with missing requirements.
* [ ] Attempting to enable scheduling without required schedule fields shows a prompt with missing requirements and keeps scheduling disabled.
* [ ] Deleting a backup plan soft-deletes it and preserves related backup history.
* [ ] A user can configure a backup schedule using presets or an advanced cron expression.
* [ ] The plan UI shows the next scheduled run time.
* [ ] A user can run a manual backup and see a new history record.
* [ ] A user can request cancellation of an in-progress backup.
* [ ] A canceled backup run is marked as canceled/partial and retains already-written artifacts.
* [ ] In-progress backup runs expose progress via polling without WebSocket/SSE.
* [ ] A scheduled backup creates history records without manual action.
* [ ] A history record lists the backed up pages/data sources and the run status.
* [ ] Backup history is paginated and defaults to newest records first.
* [ ] Backup history supports filtering/search by plan, status, trigger type, date range, and title/plan text.
* [ ] Item-level failures are recorded without stopping unrelated items.
* [ ] Global failures stop the run and mark it failed.
* [ ] Transient Notion/API/network failures are retried according to the agreed retry policy.
* [ ] A history record detail screen shows per-item status and artifact paths without rendering full backup content inline.
* [ ] A user can download a backup run manifest.
* [ ] A user can download a whole backup run as a zip archive.
* [ ] Whole-run zip archives are generated on demand and cached after first download.
* [ ] Backup artifacts include a manifest, machine-readable JSON, and human-readable Markdown where supported.
* [ ] Backup artifacts include local copies of Notion-hosted files unless disabled by the backup plan.
* [ ] Backup plan UI shows the per-file asset download limit and explains skip behavior.
* [ ] Backup plan UI includes a comments backup toggle defaulting to off.
* [ ] Backup plan UI includes a child page inclusion toggle defaulting to on for selected pages.
* [ ] Recursive child page backup deduplicates pages by ID.
* [ ] Files skipped due to size limits are visible in backup history/detail and manifest output.
* [ ] Each backup run writes artifacts using the agreed `/data/backups/runs/<run-id>/` layout.
* [ ] A user can manually delete a backup run and its files.
* [ ] Deleting a backup run requires confirmation and is not recoverable.
* [ ] Running or queued backup runs cannot be deleted directly and must be canceled first.
* [ ] Docker health checks can call unauthenticated `GET /healthz`.
* [ ] The app can be started with Docker.

## Definition of Done (Team Quality Bar)

* Tests added/updated where appropriate.
* Lint/type-check passes.
* Docker deployment path documented.
* API limitations and backup format trade-offs documented.
* Rollout/rollback considered if risky.

## Out of Scope (Explicit)

* Public hosted SaaS operations.
* Guaranteed full-fidelity Notion workspace export unless research proves the API can support it reliably.
* Two-way restore back into Notion.
* One-click re-import/restore into Notion for the MVP.
* Any restore/import workflow in the MVP.
* Automatic backup retention/cleanup rules for the MVP.
* Per-run total asset size limits for the MVP.
* Row-level filters for Notion data source backups in the MVP.
* Hierarchical/tree content selection in the MVP.
* Generic backup artifact file browser in the MVP.
* Restoring soft-deleted backup plans in the MVP.
* WebSocket/SSE real-time progress transport for the MVP.
* Dedicated CLI/admin command surface for the MVP.
* Downloading full application logs from the frontend.
* OAuth multi-workspace authorization for the MVP unless the user explicitly chooses that path.
* PostgreSQL requirement for the MVP; keep the data access layer compatible with a later Postgres migration where practical.
* Multi-user account management, roles, registration, and password reset flows.
* Re-opening setup mode after initial administrator creation.

## Technical Notes

* Repo contains Trellis scaffolding only; app stack is not yet chosen.
* Relevant spec indexes:
  * `.trellis/spec/backend/index.md`
  * `.trellis/spec/frontend/index.md`
  * `.trellis/spec/guides/index.md`
* Research needed:
  * Notion API capabilities and limitations for search, pages, blocks, databases, comments, files, and rate limits.
  * Official Notion guidance for integrations/authentication.
  * Practical backup architecture and Docker-friendly stack options.
* Research artifact:
  * `.trellis/tasks/05-14-notion-backup-tool/research/notion-api-and-architecture.md`
* Recommended stack after research:
  * TypeScript on Node.js 24 LTS.
  * Official `@notionhq/client` with `notionVersion: "2026-03-11"`.
  * Fastify backend API plus worker process.
  * React + Vite frontend.
  * SQLite for MVP metadata/history/scheduling.
  * Local Docker volume under `/data/backups` for backup artifacts.
  * Docker Compose with an `app` service and persistent data/backup volumes.
* Backup artifact layout:
  * `/data/backups/runs/<run-id>/manifest.json`
  * `/data/backups/runs/<run-id>/pages/`
  * `/data/backups/runs/<run-id>/data-sources/`
  * `/data/backups/runs/<run-id>/markdown/`
  * `/data/backups/runs/<run-id>/assets/`
  * `/data/backups/runs/<run-id>/logs.jsonl`
* Logging scope:
  * Per-run backup logs are stored in the artifact directory.
  * General app/worker logs are emitted to stdout/stderr for Docker log collection.

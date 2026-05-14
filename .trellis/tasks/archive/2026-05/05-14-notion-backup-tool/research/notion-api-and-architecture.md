# Notion API and Backup Architecture Research

Date: 2026-05-14

## Official Sources Reviewed

* Notion authorization: https://developers.notion.com/docs/authorization
* Notion internal connections: https://developers.notion.com/guides/get-started/internal-connections
* Notion API versioning: https://developers.notion.com/reference/versioning
* Notion 2026-03-11 upgrade guide: https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11
* Notion search endpoint: https://developers.notion.com/reference/post-search
* Notion search limitations: https://developers.notion.com/reference/search-optimizations-and-limitations
* Notion data source object/query: https://developers.notion.com/reference/data-source and https://developers.notion.com/reference/query-a-data-source
* Notion page/block content: https://developers.notion.com/reference/retrieve-a-page and https://developers.notion.com/reference/get-block-children
* Notion markdown content: https://developers.notion.com/guides/data-apis/working-with-markdown-content
* Notion files: https://developers.notion.com/reference/file-object
* Notion comments: https://developers.notion.com/guides/data-apis/working-with-comments
* Notion SDK for JavaScript: https://github.com/makenotion/notion-sdk-js
* Node.js release status: https://nodejs.org/en/about/releases/
* Docker build best practices: https://docs.docker.com/engine/userguide/eng-image/dockerfile_best-practices/
* Docker multi-container applications: https://docs.docker.com/get-started/docker-concepts/running-containers/multi-container-applications/

## Key Official Constraints

* The latest Notion API version is `2026-03-11`; all REST calls must send the `Notion-Version` header.
* The 2025-09-03 API split databases and data sources. Use `data_sources` for querying entries; deprecated database query endpoints should not be used for new code.
* Internal connections use a static token scoped to one workspace and require the user to explicitly share pages/databases with the connection. This fits a self-hosted MVP.
* Public integrations use OAuth and are the right direction only if the product becomes multi-workspace or multi-user SaaS.
* The search endpoint can return pages/data sources shared with the connection, but Notion explicitly says it is not guaranteed to exhaustively enumerate everything the bot can access. The UI should include refresh and a way to add a page/data source by URL or ID.
* Notion recommends direct sharing when content must appear in search immediately. Search indexing can lag after a page is shared.
* Page metadata and page content are separate. `Retrieve page` returns page properties, not content. Page content is fetched through block children or the markdown endpoint.
* `Retrieve page` can truncate properties with more than 25 page/person references; complete backup of large relations/people/formula/rollup values requires `Retrieve page property item`.
* The markdown endpoint can retrieve full page content as Notion-flavored Markdown and reports `truncated` plus `unknown_block_ids` for large or inaccessible subtrees. It is useful as a human-readable artifact, but block/page JSON should remain the canonical machine-readable backup.
* Notion-hosted file URLs are temporary and valid for one hour. A backup run must download assets during the run if local asset backup is required. External file URLs do not expire, but downloading external assets should be a separate option.
* Notion supports creating pages, appending block children, and uploading files through the API. This makes a future best-effort re-import possible, but it would create new Notion objects rather than restore original object IDs/history/permissions exactly.
* Comments can be retrieved for pages/blocks, but the API can read open/unresolved comments and cannot retrieve resolved comments.
* Notion API rate limit is an average of 3 requests per second per connection. Backup workers must throttle requests and honor 429 `Retry-After`.
* The official JavaScript SDK supports TypeScript, automatic retries, pagination helpers, type guards, and `notionVersion`. SDK version `5.12.0+` supports `2026-03-11`; use the latest v5 release available at implementation time.
* As of 2026-05-14, Node.js 24 is LTS. Docker official docs recommend multi-stage builds, trusted/minimal base images, and separating concerns across containers where practical.

## Recommended MVP Product Scope

* Self-hosted, single workspace token via Notion internal connection.
* Token setup panel with validation, masked display, and explicit content access instructions.
* Content discovery panel:
  * Search shared pages/data sources with filters and pagination.
  * Refresh button.
  * Manual add by Notion URL/ID for content not returned by search.
  * Show object type, title, parent, last edited time, and access/status.
* Backup selection:
  * Select top-level pages and data sources/databases.
  * For data sources, backup schema plus all queryable entries.
* For page/database entries, backup page metadata, complete page properties, block JSON recursively, Notion-flavored Markdown, and optional local assets.
* Download Notion-hosted files by default, with per-plan controls for size limits and whether to mirror external URL assets.
* Manual backup:
  * Creates a durable `backup_run` record before work starts.
  * Worker updates status, counters, errors, artifact paths, and item-level results.
* Scheduled backup:
  * Cron-like expression, timezone, enabled/disabled, and selected backup set.
  * Database-driven scheduler with `next_run_at`; do not rely only on in-memory timers.
* History:
  * Backup runs list with trigger type, status, start/end timestamps, selected set, counts, artifact size, and error summary.
  * Run detail listing pages/data sources backed up and per-item status.
* Restore is out of scope for MVP.

## Recommended Stack

* Language/runtime: TypeScript on Node.js 24 LTS.
* Notion SDK: official `@notionhq/client`, configured with `notionVersion: "2026-03-11"`.
* Backend: Fastify API plus a worker process in the same codebase.
* Frontend: React + Vite SPA served by the backend in production.
* Database: SQLite for the MVP to keep self-hosted Docker deployment lightweight while still providing durable config, schedules, and backup history.
* ORM/query layer: Drizzle ORM or Prisma; prefer Drizzle if we want SQL-first control, compact generated output, and a practical future path to PostgreSQL.
* Scheduling: DB-driven scheduler loop using cron expression parsing. For the MVP, run one scheduler/worker in the app process or one dedicated worker process against the same SQLite database; avoid multi-worker concurrency until PostgreSQL is introduced.
* Backup storage: local filesystem under `/data/backups` mounted as a Docker volume. Store run artifacts as JSON/Markdown/assets with a manifest per run.
* Backup artifact layout:
  * `/data/backups/runs/<run-id>/manifest.json`
  * `/data/backups/runs/<run-id>/pages/`
  * `/data/backups/runs/<run-id>/data-sources/`
  * `/data/backups/runs/<run-id>/markdown/`
  * `/data/backups/runs/<run-id>/assets/`
  * `/data/backups/runs/<run-id>/logs.jsonl`
* Deployment: Docker multi-stage image. Docker Compose can start with one `app` service plus persistent volumes:
  * `app` serves API/web assets and runs the lightweight scheduler/worker.
  * `data` named volume persists SQLite metadata.
  * `backups` named volume persists backup artifacts.
* PostgreSQL should remain a documented upgrade path for multi-user, multi-worker, remote database, or larger concurrency needs.

## Security Notes

* Never store the Notion token in source code or logs.
* Store token encrypted at rest with an `APP_ENCRYPTION_KEY` provided by environment variable or Docker secret.
* Mask tokens in the frontend after saving.
* Apply server-side validation to all token, schedule, and path/config inputs.
* Set conservative request timeouts and retry policies.
* Keep backup artifact paths under the configured backup root to avoid path traversal.

## Risks and Follow-up Decisions

* Search cannot guarantee exhaustive workspace discovery. The UX must explain that only shared/searchable content is listed and support manual add by URL/ID.
* Full backup fidelity requires both JSON and Markdown; Markdown is convenient but can lose unsupported block detail or require follow-up requests for unknown blocks.
* Large workspaces may take a long time due to the 3 req/s rate limit. The first version should show progress and allow resuming failed runs later.
* OAuth is unnecessary for a private self-hosted tool, but it becomes a major architectural change if the product later targets multiple workspaces/users.
* Re-import should be treated as a separate future feature. It can use downloaded assets plus stored JSON/Markdown to recreate pages and files, but cannot guarantee exact restoration of IDs, edit history, comments, permissions, rollups, or unsupported block details.

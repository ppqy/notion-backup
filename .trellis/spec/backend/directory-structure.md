# Backend Directory Structure

## Overview

The backend is a TypeScript/Fastify app under `src/server`. It owns HTTP APIs, auth, SQLite persistence, Notion integration, backup scheduling, and artifact writing. Shared response types live in `src/shared`.

## Directory Layout

```text
src/server/
├── index.ts                 # Fastify bootstrap, static frontend serving, worker lifecycle
├── routes.ts                # HTTP route registration and request/response glue
├── db.ts                    # SQLite connection and migrations
├── auth.ts                  # Single-admin auth and sessions
├── crypto.ts                # Secret key, token encryption, password/session hashing
├── notionClient.ts          # Notion API wrapper and retry/throttle behavior
├── backupWorker.ts          # Queue processing and backup execution
├── storage.ts               # Artifact directories, JSON/text/zip helpers
├── assets.ts                # File discovery and asset download limits
├── repositories/            # Database mapping modules
└── *.test.ts                # Unit tests next to the module being tested
```

## Module Organization

Routes must stay thin: validate input, call a repository/service, and return DTOs. Business behavior belongs in focused modules such as `backupWorker.ts`, `notionClient.ts`, or `repositories/*`.

Shared frontend/backend contracts go in `src/shared/types.ts`. Do not import server-only modules from `src/client`.

## Naming Conventions

Use camelCase in TypeScript objects and snake_case in SQLite columns. Repository modules are responsible for mapping between them.

## Scenario: Backend Cross-Layer Contract

### 1. Scope / Trigger
- Trigger: New API, DB, worker, artifact, or Notion integration behavior.

### 2. Signatures
- API routes are registered in `registerRoutes(app, worker)`.
- DB schema is migrated in `migrate()` before routes start.
- Worker entry point is `BackupWorker.start()`.

### 3. Contracts
- API responses use shared DTOs from `src/shared/types.ts`.
- Artifact root is `BACKUP_ROOT`, default `/data/backups`.
- SQLite path is `DATABASE_PATH`, default `/data/app.db`.

### 4. Validation & Error Matrix
- Invalid request body -> `400 bad_request`.
- Missing session -> `401 unauthorized`.
- Missing object/run/plan -> `404 not_found`.
- Notion token missing -> `400 bad_request`.

### 5. Good/Base/Bad Cases
- Good: route validates with Zod, calls a service, returns a shared DTO.
- Base: repository maps SQLite rows into frontend-safe objects.
- Bad: React component imports `src/server/db.ts` or reads DB column names directly.

### 6. Tests Required
- Unit-test reusable parsers/validators.
- Type-check route/service/shared DTO boundaries.
- Build must pass after adding routes or shared types.

### 7. Wrong vs Correct

#### Wrong
```ts
// UI-specific shape embedded in a SQL query result and returned directly.
return db.prepare("SELECT * FROM backup_plans").all();
```

#### Correct
```ts
// Repository maps database columns to a shared DTO.
return rows.map(mapPlanRow);
```

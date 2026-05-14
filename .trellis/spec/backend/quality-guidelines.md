# Backend Quality Guidelines

## Overview

Backend quality is enforced through strict TypeScript, production builds, and targeted Vitest tests for reusable validators/parsers. The backend should stay modular: routes validate and orchestrate, repositories map SQLite rows to DTOs, and services such as `BackupWorker` and `NotionClient` own domain behavior.

## Required Checks

- `npm run lint`
- `npm run build`
- `npm test` when validation, parsing, scheduling, DTO mapping, or backup behavior changes

## Required Patterns

- Validate request bodies with Zod schemas in `src/server/validation.ts`, then call `parseBody` from routes.
- Throw `AppError` helpers from `src/server/errors.ts` for expected failures.
- Keep frontend-facing response types aligned with `src/shared/types.ts`.
- Add tests next to backend modules when extracting reusable behavior or changing existing validators.
- Preserve token/key/session secrecy in errors, logs, and test fixtures.

## Forbidden Patterns

- Do not return raw SQLite rows from API routes; repository modules must map snake_case columns into camelCase DTOs.
- Do not log Notion tokens, `APP_ENCRYPTION_KEY`, session cookies, password hashes, or full backup payloads.
- Do not hard-delete backup plans when history must remain valid; use the existing soft-delete pattern.
- Do not import server-only modules from `src/client`.
- Do not introduce broad `any` or type casts to avoid shared DTO updates. Narrow casts that bridge existing query validation should stay local and obvious.

## Scenario: Backend Change Quality Gate

### 1. Scope / Trigger
- Trigger: New route, validation rule, repository query, migration, backup worker behavior, Notion integration change, or shared DTO change.

### 2. Signatures
- `npm run lint` runs `tsc --noEmit`.
- `npm run build` runs `tsc -p tsconfig.server.json && vite build`.
- `npm test` runs Vitest unit tests.

### 3. Contracts
- Routes register under `registerRoutes(app, worker)`.
- Route handlers must call `requireUser(request)` for authenticated APIs.
- Expected API failures must use `badRequest`, `unauthorized`, `notFound`, or `conflict`.
- New API response fields must be represented in shared DTOs before the frontend consumes them.

### 4. Validation & Error Matrix
- Request validation change -> update or add Zod schema tests.
- Notion ID/token parsing change -> update parser/token tests.
- Schedule requirement change -> update `planMissingRequirements` tests.
- Migration or repository change -> verify row-to-DTO mapping and run a production build.

### 5. Good/Base/Bad Cases
- Good: add a unit test for a reusable parser before relying on it from routes.
- Base: type-check after changing `src/shared/types.ts`.
- Bad: route returns `db.prepare(...).all()` directly and lets the frontend depend on DB column names.

### 6. Tests Required
- Parser/normalizer changes need Vitest coverage similar to `src/server/notionIds.test.ts`.
- Validation changes need coverage similar to `src/server/validation.test.ts`.
- Shared DTO or route changes must pass `npm run lint` and `npm run build`.

### 7. Wrong vs Correct

#### Wrong
```ts
app.post("/api/plans", async (request) => {
  return db.prepare("SELECT * FROM backup_plans").all();
});
```

#### Correct
```ts
app.post("/api/plans", async (request) => {
  requireUser(request);
  const input = parseBody(backupPlanInputSchema, request.body);
  return createPlan(input);
});
```

## Example Test Pattern

Keep tests focused on stable contracts rather than implementation details.

```ts
it("requires the current ntn_ token prefix", () => {
  expect(notionTokenSchema.safeParse({ token: `${NOTION_TOKEN_PREFIX}valid_token` }).success).toBe(true);
  expect(notionTokenSchema.safeParse({ token: "secret_legacy_token" }).success).toBe(false);
});
```

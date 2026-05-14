# Logging Guidelines

## Overview

Fastify logs app and request events to stdout/stderr for Docker. Each backup run writes structured per-run logs to `/data/backups/runs/<run-id>/logs.jsonl`.

## What to Log

- App startup and request lifecycle through Fastify.
- Backup run start/finish/cancel/failure.
- Item-level backup failures.
- Retry attempts and skipped file downloads.

## What Not to Log

- Notion token values.
- `APP_ENCRYPTION_KEY` values.
- Session cookies or password hashes.
- Full backed-up page content in app logs.

## Scenario: Per-Run Backup Logs

### 1. Scope / Trigger
- Trigger: Backup worker, retry, asset download, or run/item error behavior.

### 2. Signatures
- `new RunLogger(runDir).write(level, event, data)`
- Log file: `<run-dir>/logs.jsonl`.

### 3. Contracts
- Each line is JSON with `timestamp`, `level`, `event`, and event fields.
- General app logs stay on stdout/stderr.
- Frontend exposes per-run summaries/links, not full app log downloads.

### 4. Validation & Error Matrix
- Asset exceeds size limit -> `asset_skipped` warn event.
- Notion retry -> `notion_retry` warn event.
- Item failure -> `item_failed` error event.

### 5. Good/Base/Bad Cases
- Good: log object ID and error class, not token.
- Base: write retry attempts to `logs.jsonl`.
- Bad: dumping raw backup JSON into app stdout.

### 6. Tests Required
- Add tests for log-producing helpers when log format changes.

### 7. Wrong vs Correct

#### Wrong
```ts
app.log.info({ token }, "saving token");
```

#### Correct
```ts
await logger.write("warn", "asset_skipped", { pageId, reason });
```

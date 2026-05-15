# Notion Backup

![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

Languages: English | [简体中文](README_CN.md)

Self-hosted Notion backup dashboard for selecting pages and data sources, running manual or scheduled backups, and storing backup metadata locally in SQLite.

The product UI is Chinese-first. The runtime is a single Fastify server that serves the React dashboard, owns the API, runs the backup worker, and writes artifacts to local disk or a mounted Docker data directory.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start with Docker](#quick-start-with-docker)
- [Published Docker Images](#published-docker-images)
- [Local Development](#local-development)
- [Notion Setup](#notion-setup)
- [Configuration](#configuration)
- [Backup Data](#backup-data)
- [Available Scripts](#available-scripts)
- [Project Structure](#project-structure)
- [Quality Checks](#quality-checks)
- [Security Notes](#security-notes)
- [License](#license)

## Features

- First-run setup flow for the initial admin account, encryption key acknowledgement, Notion token setup, and optional first backup plan.
- Single-admin login with password hashing and HTTP-only cookie sessions.
- Notion token validation, masking, and encrypted local storage.
- Automatic Notion content discovery through search, plus manual page/data-source add by URL or ID.
- Backup plans with manual runs, hourly/daily/weekly/monthly schedules, custom cron expressions, and timezone support.
- Backup options for child pages, comments, Notion-hosted file downloads, external file mirroring, and per-file size limits.
- Run queue with progress polling, cancellation, filtered history, manifest download, and zip archive download.
- Local SQLite metadata and filesystem artifacts for simple self-hosted operation.

## Tech Stack

- **Runtime:** Node.js, TypeScript, Fastify
- **Frontend:** React, Vite, lucide-react
- **Storage:** SQLite via better-sqlite3, local filesystem artifacts
- **Validation:** Zod
- **Scheduling:** cron-parser
- **Notion:** `@notionhq/client` with API version `2026-03-11`
- **Testing:** Vitest
- **Deployment:** Docker and Docker Compose

## Prerequisites

Choose one runtime path:

- Docker Engine with Docker Compose
- Node.js 24.x and npm for local development

You also need a Notion internal integration token that starts with `ntn_`, and the integration must be shared with the pages or data sources you want to back up.

## Quick Start with Docker

```bash
cp .env.example .env
docker compose up -d
```

Open `http://localhost:3000` and complete the setup flow:

1. Create the first admin account.
2. Save the generated encryption key if the app did not receive `APP_ENCRYPTION_KEY`.
3. Paste and validate your Notion integration token.
4. Create a backup plan or skip to the dashboard.

Stop the container:

```bash
docker compose down
```

The Compose setup mounts `./data` on the host to `/data` in the container, so application data stays directly visible under the local `data/` directory.

## Published Docker Images

GitHub Actions publishes Docker images to GitHub Container Registry from `.github/workflows/docker-publish.yml`.

- Pull requests to `main` run quality checks and build the Docker image without pushing it.
- Pushes to `main` publish `ghcr.io/ppqy/notion-backup:main` and `sha-<short-sha>`.
- Git tags matching `v*.*.*` publish the tag name, semantic version tags, `latest`, and `sha-<short-sha>`.
- Published images support `linux/amd64` and `linux/arm64`.
- Manual runs are available from the workflow dispatch button in GitHub Actions.

The default Compose file uses the moving `main` image until release tags are available:

```yaml
services:
  notion-backup:
    image: ghcr.io/ppqy/notion-backup:main
```

If the GHCR package remains private, log in before pulling:

```bash
echo "<github-token>" | docker login ghcr.io -u ppqy --password-stdin
```

## Local Development

Install dependencies:

```bash
npm install
```

Run the backend API and worker:

```bash
npm run dev
```

In another terminal, run the Vite dev server:

```bash
npm run dev:client
```

Open `http://localhost:5173`. Vite proxies `/api` and `/healthz` to the backend on `http://localhost:3000`.

Local development defaults to:

- `DATA_DIR=./data`
- `DATABASE_PATH=./data/app.db`
- `BACKUP_ROOT=./data/backups`

The Node dev command does not automatically load `.env`; export variables in your shell when you need to override these defaults.

## Notion Setup

1. Create an internal Notion integration in your Notion workspace.
2. Copy the integration token. The app validates tokens that start with `ntn_`.
3. Share each target page or data source with the integration in Notion.
4. Paste the token in the app setup flow or in **Notion Settings**.
5. Refresh discovered content, or manually add a Notion URL/ID if the item is not found by search.

Only content that the integration can access can be backed up.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` in app, `production` in `.env.example` | Runtime environment. |
| `HOST` | `0.0.0.0` | Host interface for the Fastify server. |
| `PORT` | `3000` | HTTP port. Docker Compose maps `${PORT:-3000}` on the host to container port `3000`. |
| `DATA_DIR` | `./data` locally, `/data` in Docker | Root directory for persistent app data. |
| `DATABASE_PATH` | `${DATA_DIR}/app.db` | SQLite database path. |
| `BACKUP_ROOT` | `${DATA_DIR}/backups` | Root directory for backup artifacts. |
| `APP_ENCRYPTION_KEY` | unset | Optional stable key for encrypting the Notion token. Supports 64-char hex, base64, or a passphrase. |
| `SESSION_COOKIE_NAME` | `notion_backup_session` | Admin session cookie name. |
| `SESSION_SECURE` | `false` | Set to `true` when serving the app over HTTPS. |

## Backup Data

Docker Compose stores these files under the host-mounted `./data` directory, which is mounted to `/data` in the container. Local development stores the same layout under `./data` by default.

```text
data/
|-- app.db
|-- app-secret.json
`-- backups/
    `-- runs/
        `-- <run-key>/
            |-- manifest.json
            |-- logs.jsonl
            |-- pages/
            |-- data-sources/
            |-- markdown/
            |-- assets/
            `-- archive.zip        # created on first zip download
```

Each run writes JSON artifacts for selected pages and data sources. Markdown and comments are captured when enabled and available from the Notion API. File assets are downloaded according to the plan options and size limit.

## Available Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Fastify backend and backup worker with `tsx watch`. |
| `npm run dev:client` | Start the Vite dev server on port `5173`. |
| `npm run build` | Build the server and frontend into `dist/`. |
| `npm start` | Start the production server from `dist/server/index.js`. |
| `npm run typecheck` | Run TypeScript type checking. |
| `npm run lint` | Alias for TypeScript type checking. |
| `npm test` | Run Vitest unit tests. |

## Project Structure

```text
src/
|-- client/
|   |-- api.ts          # Typed API helpers
|   |-- main.tsx        # React app, pages, setup flow, and dashboard views
|   `-- styles.css      # App-wide styles
|-- server/
|   |-- index.ts        # Fastify bootstrap, static frontend serving, worker lifecycle
|   |-- routes.ts       # HTTP routes
|   |-- db.ts           # SQLite connection and migrations
|   |-- auth.ts         # Admin auth and sessions
|   |-- crypto.ts       # Encryption, password hashing, session token hashing
|   |-- notionClient.ts # Notion API wrapper, throttling, and retry behavior
|   |-- backupWorker.ts # Queue processing and backup execution
|   `-- repositories/   # SQLite mapping modules
`-- shared/
    |-- constants.ts
    `-- types.ts        # Shared frontend/backend DTOs
```

## Quality Checks

Run these before opening a pull request or publishing a build:

```bash
npm run lint
npm run build
npm test
```

The health endpoint is available at:

```text
GET /healthz
```

It checks database connectivity and returns the current server time.

## Security Notes

- Keep `APP_ENCRYPTION_KEY` or `data/app-secret.json` with the database backup. If the encryption key is lost, the stored Notion token cannot be decrypted and must be entered again.
- Protect the `./data` directory or whichever host path you bind mount to `/data`. It contains the SQLite database, encrypted token, run metadata, and backup artifacts.
- Set `SESSION_SECURE=true` behind HTTPS.
- This app is designed for self-hosted single-admin use. Put it behind your own reverse proxy, VPN, or access controls before exposing it outside a trusted network.
- Backups are limited to content accessible to the configured Notion integration; this is not a full workspace export.

## License

No license file is currently included.

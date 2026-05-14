# Notion Backup

Self-hosted Notion backup tool with a Chinese web dashboard, manual backups, scheduled backup plans, local SQLite metadata, and Docker deployment.

## Quick Start

```bash
cp .env.example .env
docker compose up -d --build
```

Open `http://localhost:3000` and complete first-run setup.

## Data

The Docker volume stores:

```text
/data/app.db
/data/app-secret.json
/data/backups/runs/<run-id>/
```

If `APP_ENCRYPTION_KEY` is not set, the app generates one under the data volume and shows it once during setup. Save it if you plan to migrate or restore the data volume later.

## Development

```bash
npm install
npm run dev
npm run dev:client
```

The backend runs on `3000`; Vite runs on `5173` and proxies `/api`.

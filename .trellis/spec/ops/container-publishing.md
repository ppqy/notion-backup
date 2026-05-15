# Container Publishing

## Scenario: GHCR Docker Image Publishing

### 1. Scope / Trigger

- Trigger: Any change to `.github/workflows/docker-publish.yml`, `Dockerfile`, `.dockerignore`, or README deployment instructions for published images.
- Purpose: Keep GitHub Actions publishing predictable, secret-safe, and compatible with Docker Compose deployment.

### 2. Signatures

- Workflow file: `.github/workflows/docker-publish.yml`
- Registry: `ghcr.io`
- Image name expression: `${{ github.repository }}`
- Default image path: `ghcr.io/ppqy/notion-backup`
- Default Compose image while release tags are absent: `ghcr.io/ppqy/notion-backup:main`
- Default Compose persistence mount: `./data:/data`
- Required workflow permissions:
  - `contents: read`
  - `packages: write` for publishing to GHCR
  - `attestations: write` and `id-token: write` when pushing artifact attestations

### 3. Contracts

- Pull requests to `main` must build without pushing an image.
- Pushes to `main` must publish a moving `main` tag and an immutable `sha-<short-sha>` tag.
- Git tags matching `v*.*.*` must publish version tags plus `latest`.
- Runtime secrets such as `APP_ENCRYPTION_KEY`, Notion tokens, session cookies, and database files must never be copied into the Docker image.
- Persistent app data must remain under `/data` and be provided by a Docker volume or host mount at runtime.
- The default `docker-compose.yml` is deployment-first: it must pull `ghcr.io/ppqy/notion-backup:main` instead of building locally until release tags are available.
- The default `docker-compose.yml` must bind mount `./data` to `/data` so backup data is visible to host backup tools.

### 4. Validation & Error Matrix

- Workflow YAML is invalid -> GitHub Actions will not start; validate syntax before committing.
- `packages: write` is missing -> GHCR push fails with an authorization error.
- Login runs on pull requests from forks -> avoid by gating registry login and image push to non-PR events.
- `.env`, `data/`, or local build output enters the Docker context -> fix `.dockerignore`.
- A published image fails `npm run build` -> block the publish job until lint/build/test pass.

### 5. Good/Base/Bad Cases

- Good: PRs run lint, build, tests, and Docker build with `push: false`.
- Good: Default Compose pulls `ghcr.io/ppqy/notion-backup:main` and mounts `./data:/data`.
- Base: `main` publishes `main` and `sha-<short-sha>` using `GITHUB_TOKEN`.
- Bad: Default Compose uses `build: .` or a named volume while README says backup data is stored under `./data`.
- Bad: Workflow stores a registry password in plain text or pushes `latest` on every branch build.

### 6. Tests Required

- Run `npm run lint` to verify TypeScript checks.
- Run `npm run build` to verify the production app build that the Docker image depends on.
- Run `npm test` before publishing workflows that can push images.
- Parse workflow YAML locally when editing the workflow.
- Run `docker compose config` after changing `docker-compose.yml`.

### 7. Wrong vs Correct

#### Wrong

```yaml
- uses: docker/build-push-action@v7
  with:
    push: true
    tags: ghcr.io/example/notion-backup:latest
```

#### Correct

```yaml
- uses: docker/build-push-action@v7
  with:
    push: ${{ github.event_name != 'pull_request' }}
    tags: ${{ steps.meta.outputs.tags }}
```

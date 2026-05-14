# brainstorm: GitHub Actions Docker image publishing

## Goal

Design a GitHub Actions workflow for building the existing Docker image and publishing it to a remote container registry when the project is pushed to GitHub, so the app can be deployed by pulling a versioned image instead of rebuilding on the server.

## What I Already Know

* The project already has a multi-stage `Dockerfile` based on Node 24 and exposes port `3000`.
* `docker-compose.yml` currently uses `build: .`, so deployment docs/config can later switch to an `image:` reference once a registry target is chosen.
* Package scripts include `npm run lint`, `npm run build`, and `npm test`.
* There is no existing `.github/workflows/` directory.
* The app persists runtime data under `/data`, so published images should stay stateless and keep `/data` mounted as a volume.

## Assumptions

* The first target is a single published image for `linux/amd64`, with optional `linux/arm64` if the deployment host needs it.
* Runtime secrets such as `APP_ENCRYPTION_KEY` and Notion token configuration are not baked into the image.
* The safest default registry for a GitHub-hosted project is GitHub Container Registry unless the user already has Docker Hub or a cloud registry preference.

## Decisions

* Publish to GitHub Container Registry (GHCR).

## Requirements

* Build the repository `Dockerfile` in GitHub Actions.
* Push immutable version tags and a convenient moving tag.
* Avoid committing registry credentials to the repository.
* Keep deployment-compatible image naming and tagging.
* Document how to pull the GHCR image and switch Compose from local build mode to published-image mode.

## Acceptance Criteria

* [x] A registry choice is selected.
* [x] A workflow design defines trigger rules, image tags, permissions/secrets, and cache strategy.
* [x] If implemented, pushing to `main` publishes an image and tag pushes publish versioned images.

## Definition of Done

* Tests added/updated where appropriate.
* Lint / typecheck / CI green if implementation changes are made.
* Docs/notes updated if deployment behavior changes.
* Rollout/rollback considered if risky.

## Out of Scope

* Automatically deploying the image to a server after publishing.
* Baking application secrets into the Docker image.
* Changing application runtime behavior.

## Technical Notes

* Repo files inspected: `Dockerfile`, `docker-compose.yml`, `package.json`, `README.md`, `README_CN.md`.
* Research notes: `research/github-actions-docker-publish.md`.
* Added operations spec for container publishing: `.trellis/spec/ops/container-publishing.md`.

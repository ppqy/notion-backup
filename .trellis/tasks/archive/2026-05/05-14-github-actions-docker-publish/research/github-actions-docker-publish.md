# GitHub Actions Docker Publish Research

## Sources

* GitHub Docs, "Publishing Docker images": https://docs.github.com/actions/language-and-framework-guides/publishing-docker-images
* Docker Build Push Action: https://github.com/docker/build-push-action
* Docker Metadata Action: https://github.com/docker/metadata-action
* Docker Login Action: https://github.com/docker/login-action
* Docker Setup Buildx Action: https://github.com/docker/setup-buildx-action
* Actions Checkout: https://github.com/actions/checkout
* Actions Setup Node: https://github.com/actions/setup-node

## Findings

* GitHub's official Docker publishing guide includes a GHCR workflow using `packages: write` permission and `GITHUB_TOKEN` authentication.
* Docker's maintained action stack is the common baseline:
  * `docker/login-action` authenticates to GHCR, Docker Hub, or cloud registries.
  * `docker/metadata-action` derives tag and label metadata from branches, tags, PRs, and SHA.
  * `docker/build-push-action` builds and optionally pushes the Dockerfile, with BuildKit support and cache options.
* GHCR is the lowest-friction target for a GitHub repository because it can use `${{ secrets.GITHUB_TOKEN }}` rather than a manually managed registry password.
* Docker Hub is better when the image should be easy for non-GitHub users to pull by a familiar namespace, but it requires `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets.
* Cloud registries such as AWS ECR, GCP Artifact Registry, or Azure Container Registry are best when the deployment target already runs in that cloud or needs cloud IAM integration.
* Current major versions checked on 2026-05-14:
  * `actions/checkout@v6`
  * `actions/setup-node@v6`
  * `docker/login-action@v4`
  * `docker/setup-buildx-action@v4`
  * `docker/metadata-action@v6`
  * `docker/build-push-action@v7`
* Recommended tags for this project:
  * Branch pushes to `main`: `main` plus `sha-<shortsha>`.
  * Git tags like `v1.2.3`: semantic version tags and `latest`.
  * Pull requests: build only, do not push.
* Cache strategy: use GitHub Actions cache via BuildKit `cache-from: type=gha` and `cache-to: type=gha,mode=max`.
* Multi-arch builds need QEMU plus Buildx and slower CI time. Start with `linux/amd64` unless the target host is ARM.

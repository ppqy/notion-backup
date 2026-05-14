# Operations Guidelines

> Operational and CI/CD conventions for this project.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Container Publishing](./container-publishing.md) | Docker image publishing, tagging, and registry rules | Filled |

---

## Pre-Development Checklist

Before changing CI/CD, Docker, or deployment files, read:

1. [Container Publishing](./container-publishing.md)
2. [Backend Quality Guidelines](../backend/quality-guidelines.md) when the change affects production build behavior

## Quality Check

For CI/CD and container publishing changes:

1. Validate YAML syntax where possible.
2. Run `npm run lint`, `npm run build`, and `npm test` when the workflow will publish production images.
3. Confirm no runtime secrets are baked into the image or committed into workflow files.
4. Confirm published tags are documented in the README.

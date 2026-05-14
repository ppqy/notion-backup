# Frontend Directory Structure

## Overview

The frontend is a React/Vite single-page app under `src/client`. It is served by Fastify from `dist/client` in production.

## Directory Layout

```text
src/client/
├── main.tsx      # React app, pages, and feature components
├── api.ts        # Typed API helper and endpoint functions
└── styles.css    # App-wide CSS

src/shared/
└── types.ts      # Shared API DTOs used by frontend and backend
```

## Scenario: Frontend/API Boundary

### 1. Scope / Trigger
- Trigger: New API consumer, shared DTO, page, or cross-layer UI behavior.

### 2. Signatures
- `api<T>(path, options)` handles JSON, credentials, and error extraction.
- Endpoint wrappers live in `src/client/api.ts`.

### 3. Contracts
- UI labels are Chinese-first.
- Shared types come from `src/shared/types.ts`.
- Server-only modules must not be imported from `src/client`.

### 4. Validation & Error Matrix
- API error response -> show `error.message` to the user.
- Missing Notion token -> show empty state and setup/settings entry.
- Incomplete plan run/enable -> show missing requirements.

### 5. Good/Base/Bad Cases
- Good: component calls `endpoints.createPlan(payload)`.
- Base: local React state for forms and filters.
- Bad: component manually repeats `fetch` error parsing in multiple places.

### 6. Tests Required
- Type-check frontend after shared DTO changes.
- Add component tests if UI logic grows beyond simple state.

### 7. Wrong vs Correct

#### Wrong
```ts
fetch("/api/plans", { body: JSON.stringify(form) });
```

#### Correct
```ts
await endpoints.createPlan(payload);
```

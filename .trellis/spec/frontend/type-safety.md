# Type Safety

## Overview

TypeScript is strict. Shared API DTOs live in `src/shared/types.ts`; request payloads that are frontend-specific can be typed in `src/client/api.ts`.

## Runtime Validation

Runtime request validation happens on the backend with Zod. Frontend forms should still prevent obvious invalid local values where practical.

## Scenario: Shared DTOs

### 1. Scope / Trigger
- Trigger: API response shape, enum, plan payload, run status, or discovered content change.

### 2. Signatures
- `BackupPlan`
- `BackupRunSummary`
- `BackupRunDetail`
- `DiscoveredContent`
- `NotionConnectionStatus`

### 3. Contracts
- API responses should match shared DTO names and casing.
- Frontend must not depend on SQLite column names.

### 4. Validation & Error Matrix
- Unknown API error -> display generic `操作失败`.
- Known API error -> display server-provided Chinese message.

### 5. Good/Base/Bad Cases
- Good: status label switch covers every `BackupRunStatus`.
- Base: endpoint helper returns `Promise<T>`.
- Bad: passing untyped `any` objects across API/UI boundaries.

### 6. Tests Required
- `npm run typecheck` after changing shared types.

### 7. Wrong vs Correct

#### Wrong
```ts
function renderRun(run: any) {}
```

#### Correct
```ts
function renderRun(run: BackupRunSummary) {}
```

### Convention: Shared Validation Constants

**What**: Cross-layer validation literals that appear in both UI copy and server schemas live in `src/shared/constants.ts`.

**Why**: Keeping literals shared prevents the UI from advertising one contract while the backend accepts another.

**Example**:
```tsx
import { NOTION_TOKEN_PREFIX } from "../shared/constants";

<input placeholder={`${NOTION_TOKEN_PREFIX}...`} />
```

**Related**: Backend Zod schemas must import the same constant when enforcing the corresponding request contract.

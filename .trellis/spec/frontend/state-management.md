# State Management

## Overview

The MVP uses React local state and HTTP polling. There is no global client state library.

## Server State

Fetch server state through `src/client/api.ts`. Poll active/run history screens every few seconds for live-ish progress.

## Scenario: Polling-Based Backup Progress

### 1. Scope / Trigger
- Trigger: Backup run list/detail, dashboard running state, or progress UI.

### 2. Signatures
- `GET /api/dashboard`
- `GET /api/runs`
- `GET /api/runs/:id`

### 3. Contracts
- Progress fields: phase, processed count, failed count, total when known, current item title.
- Polling only; do not add WebSocket/SSE for MVP.

### 4. Validation & Error Matrix
- Poll failure -> keep current UI state and surface next actionable error if user initiated the action.
- Run canceled -> show terminal canceled/partial state.

### 5. Good/Base/Bad Cases
- Good: history view refreshes every 5 seconds.
- Base: form state remains local to the editor component.
- Bad: adding global stores for one-page form state.

### 6. Tests Required
- Type-check when run status enums change.

### 7. Wrong vs Correct

#### Wrong
```ts
const socket = new WebSocket("/runs");
```

#### Correct
```ts
setInterval(() => endpoints.runs(params).then(setRuns), 5000);
```

# Frontend Quality Guidelines

## Overview

Frontend quality is enforced through TypeScript build/typecheck. The UI should remain practical, scan-friendly, and responsive across desktop/mobile.

## Required Checks

- `npm run lint`
- `npm run build`
- `npm run test` when behavior utilities change

## Scenario: MVP Dashboard Quality

### 1. Scope / Trigger
- Trigger: New page, form, data table, download action, or destructive action.

### 2. Signatures
- Pages are rendered from `Shell` navigation.
- API actions go through `endpoints`.

### 3. Contracts
- Buttons that delete/cancel/clear must be visually distinct.
- Text must fit on mobile; CSS uses responsive grid collapse.
- Do not add visible feature tutorials beyond required setup/security explanations.

### 4. Validation & Error Matrix
- Delete plan -> confirmation; preserves history.
- Delete run -> confirmation; permanent.
- Clear token -> confirmation; clears cache and identity.

### 5. Good/Base/Bad Cases
- Good: status filters and search are available on growing lists.
- Base: drawer for detail/editing.
- Bad: rendering a tree selector for MVP content discovery; use flat list.

### 6. Tests Required
- Typecheck every frontend change.
- Add tests when extracting complex UI state helpers.

### 7. Wrong vs Correct

#### Wrong
```tsx
<button onClick={deleteRun}>删除</button>
```

#### Correct
```tsx
if (confirm("永久删除这次备份及文件？")) {
  await endpoints.deleteRun(run.id);
}
```

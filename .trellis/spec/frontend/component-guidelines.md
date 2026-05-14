# Component Guidelines

## Overview

Components are plain React function components. Keep MVP UI dense, operational, and Chinese-first. Use `lucide-react` icons in buttons where a matching icon exists.

## Styling

Use `src/client/styles.css`. Cards are limited to repeated rows, forms, drawers, and framed tool surfaces. Avoid nested cards and marketing-style sections.

## Scenario: Operational Dashboard UI

### 1. Scope / Trigger
- Trigger: New dashboard page, form, table/list, drawer, or status component.

### 2. Signatures
- Components accept typed props.
- Buttons use text plus lucide icons for clear commands.

### 3. Contracts
- Dashboard copy is Chinese.
- Do not render full backup JSON/Markdown inline.
- Use polling for progress; no WebSocket/SSE in MVP.

### 4. Validation & Error Matrix
- Destructive delete -> browser confirmation or explicit confirm UI.
- Running/queued run delete -> prompt cancel first.
- Form API errors -> show message near the form.

### 5. Good/Base/Bad Cases
- Good: history row shows status, counts, and actions.
- Base: drawer for run detail or plan editor.
- Bad: full-page hero/marketing content instead of the usable app.

### 6. Tests Required
- Type-check component props.
- Add tests for complex conditional rendering.

### 7. Wrong vs Correct

#### Wrong
```tsx
<pre>{JSON.stringify(backupJson, null, 2)}</pre>
```

#### Correct
```tsx
<a href={`/api/runs/${run.id}/manifest`}>manifest</a>
```

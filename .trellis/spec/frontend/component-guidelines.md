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

### Convention: Drawer Backdrop Close

Drawer overlays should close when the user clicks outside the drawer panel. Stop propagation on the panel so form interactions do not close it.
Drawer panel grids should align content at the top (`align-content: start` or equivalent) so detail sections are not stretched across the full viewport height.

```tsx
<div className="drawer" onClick={onClose}>
  <section className="drawer-panel" onClick={(event) => event.stopPropagation()}>
    ...
  </section>
</div>
```

### Convention: Compact Filter Toolbars

Toolbar filter controls should stay compact on desktop. Override the global full-width input/select rule inside `.toolbar`, and only expand controls to full width in mobile media queries.

### Convention: Run Status Badges

Run-level and item-level status badges must share one mapping helper instead of repeating inline ternaries in each drawer/list. Backup and restore item status `skipped` means the item is terminal/canceled, so it must render with the static canceled icon, not the spinning running icon.

```tsx
<StatusBadge status={itemStatusBadgeStatus(item.status)} />
```

Do not hand-map detail rows separately from history rows. When adding a new run/item status, update the shared badge helper and its tests first.

### Convention: Queued Action Feedback

Manual actions that enqueue background work should use an in-app confirmation dialog before the API call, then an in-app feedback dialog after the task is queued. Do not use `alert()`, browser `confirm()`, or text-only status for this enqueue path. The feedback dialog should show the queued record key/status and include a primary action that navigates to the polling list where progress is visible.

```tsx
<ConfirmActionDialog
  title="确认手动备份"
  message="将立即创建一个备份任务，入队后可在备份历史查看进度。"
  detail={`计划：${plan.name} · ${plan.selectedContent.length} 个对象`}
  confirmLabel="确认入队"
  icon={<Play />}
  confirmIcon={<Play />}
  busy={runningPlanId === plan.id}
  onConfirm={() => runManualBackup(plan)}
  onClose={() => setConfirmingPlan(null)}
/>

<QueuedActionDialog
  title="备份已排队"
  message="手动备份任务已创建，备份历史会自动刷新进度。"
  detail={`备份记录：${queuedRun.runKey} · ${statusLabel(queuedRun.status)}`}
  actionLabel="查看备份历史"
  actionIcon={<History />}
  onAction={() => go("history")}
  onClose={() => setQueuedRun(null)}
/>
```

Use the existing `Shell` view navigation for these jumps. Keep API errors near the triggering form/action, and keep list progress polling in the target history/list view.

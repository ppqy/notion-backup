# brainstorm: unified backup restore feedback navigation

## Goal

Improve the manual backup and manual restore feedback flow so users can jump directly to the list that shows progress after a task is queued.

## What I already know

* Backup plan rows currently call `endpoints.runPlan(plan.id)`, refresh plans, then show `alert("备份已排队")`.
* Restore is started from backup history detail through `RestorePanel`; after `endpoints.restoreRun(...)`, it only sets text: `恢复任务已排队，可在「恢复」中查看进度`.
* `Shell` already owns local view state with `View = "dashboard" | "notion" | "plans" | "history" | "restore" | "security"`.
* Backup history and restore list already poll every 5 seconds, so no backend or realtime transport change is needed.

## Assumptions

* A modal/drawer-style success dialog is acceptable as the shared feedback pattern.
* Jump targets are the existing `history` view for backups and `restore` view for restores.
* The queued backup/restore identifiers should be shown in the confirmation where available.

## Requirements

* After clicking manual backup from the plan list and the API succeeds, show a non-browser feedback dialog.
* Manual backup must show an in-app confirmation dialog before creating the backup task.
* The manual backup feedback must include a button to jump to backup history.
* After clicking confirm restore and the API succeeds, show the same feedback pattern.
* The manual restore feedback must include a button to jump to the restore list.
* Manual restore must show an in-app confirmation dialog before creating the restore task.
* Manual backup and manual restore confirmation must not use browser `confirm()` dialogs.
* Keep existing error handling near the triggering UI.

## Acceptance Criteria

* [ ] Clicking "手动备份" opens an in-app confirmation dialog before the backup API call.
* [ ] Manual backup success shows a dialog with queued status and a "查看备份历史" action.
* [ ] Clicking "查看备份历史" closes any open feedback/drawer state and navigates to the backup history view.
* [ ] Clicking restore "确认入队" opens an in-app confirmation dialog before the restore API call.
* [ ] Manual restore success shows a dialog with queued status and a "查看恢复列表" action.
* [ ] Clicking "查看恢复列表" navigates to the restore view.
* [ ] Neither manual backup nor manual restore uses a browser confirm dialog.
* [ ] Existing backup and restore progress polling remains unchanged.
* [ ] `npm run lint` and `npm run build` pass.

## Definition of Done

* Tests added/updated when behavior utilities change.
* Lint / typecheck / build green.
* Docs/notes updated if behavior changes.
* Rollout/rollback considered if risky.

## Out of Scope

* Filtering the target history/list to the newly queued run.
* Backend API changes.
* WebSocket/SSE or other realtime transport.

## Technical Notes

* Relevant files: `src/client/main.tsx`, `src/client/styles.css`.
* Follow frontend spec: Chinese-first copy, `endpoints` API wrappers, local state, compact operational UI, lucide icons in buttons.

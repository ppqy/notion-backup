# Fix Setup UI Regressions

## Goal

Fix the UI and validation issues found during manual testing after the MVP setup flow work.

## What I Already Know

- The setup page should center the active setup form together with the step indicator.
- Notion integration tokens should be presented and validated as `ntn_...`, not `secret_...`.
- Discovered content rows currently show source text as `搜索`, which is easy to mistake for a clickable search action.
- Search inputs use an icon wrapper, but focus styling is applied only to the inner input.
- Some buttons stretch as grid items and occupy a full row unintentionally.

## Requirements

- Center the setup step indicator and active setup panel as a group.
- Change Notion token placeholder and local/server validation to require `ntn_`.
- Clarify discovered content row source text so it reads as a status/source, not an action.
- Apply focus styling to the full search box including the search icon.
- Review button CSS so buttons keep natural width unless a component deliberately opts into full-width behavior.
- Show precise setup password/username validation messages instead of generic request errors.
- Show visible feedback after copying the generated setup security key.
- Allow the plan create/edit drawer to close when clicking outside the drawer panel.
- Keep plan/history filter controls compact on desktop.
- Align discovered-content row layout between the Notion settings page and the plan editor selector.
- Keep backup history detail drawer content grouped at the top with normal spacing.

## Acceptance Criteria

- [x] Setup admin form appears centered on first-run setup.
- [x] Token form displays `ntn_...` and rejects values that do not start with `ntn_`.
- [x] Discovered content rows no longer show a bare `搜索` label.
- [x] Search field focus outline/border wraps both icon and input.
- [x] Buttons in grid/form sections do not stretch to full width by default.
- [x] Short setup passwords show a specific Chinese validation message.
- [x] Copying the setup security key shows a visible success/failure message.
- [x] Plan create/edit drawer closes by clicking outside the panel.
- [x] Plan/history filters no longer force every control onto its own row on desktop.
- [x] Discovered content source labels align consistently with and without checkboxes.
- [x] Backup history detail drawer no longer stretches sections across the full viewport height.
- [x] `npm run lint` and `npm run build` pass.

## Definition of Done

- TypeScript remains strict and green.
- UI changes stay in `src/client/styles.css` unless component copy/structure changes are needed.
- Backend request validation continues to use Zod and standard error handling.

## Out of Scope

- Redesigning the setup flow beyond alignment fixes.
- Adding a new content discovery workflow.
- Changing Notion API integration behavior after token validation.

## Technical Notes

- Relevant files inspected: `src/client/main.tsx`, `src/client/styles.css`, `src/server/validation.ts`, `src/shared/constants.ts`.
- Relevant specs loaded: frontend component, quality, type-safety; backend error handling and quality index.

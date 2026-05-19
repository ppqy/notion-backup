# Group Discovered Notion Content

## Goal

Improve the Notion settings and plan-selection experience by presenting discovered backup targets in a hierarchy instead of a flat list. Pages or data sources nested under another discovered item should appear under their parent, and database entry pages should not dominate the first-level list.

## Requirements

* Use Notion object parent metadata already captured during discovery to build a local hierarchy.
* Keep automatic discovery and manual add behavior intact.
* Show top-level discovered pages/data sources first.
* Nest discovered children under their discovered parent when the parent is also present in the cache.
* Group items whose parent is not available into an explicit orphan/manual-style section rather than losing them.
* Keep search and type filtering working.
* Keep backup plan selection working from the same discovery panel.
* Default to a lightweight cached-parent solution; do not recursively crawl full page block trees in this task.

## Acceptance Criteria

* [x] A page whose `parent` points to a discovered page appears indented under that page.
* [x] A page whose `parent` points to a discovered data source appears under that data source instead of as a root item.
* [x] A discovered item with an inaccessible or undiscovered parent remains selectable and appears under a clear fallback group.
* [x] The Notion settings page and backup plan editor both use the grouped discovery display.
* [x] Search and type filters still return relevant selectable items.
* [x] Existing backup plan creation/editing behavior remains compatible with selected content.
* [x] Repository/unit tests cover parent parsing and grouping behavior where practical.
* [x] Lint/type-check/test commands pass or any environment blocker is documented.
* [x] Restore preflight shows how many data source internal pages/entries will be restored.
* [x] Restore reports and restore history show how many data source internal pages were created.
* [x] Restore UI displays standalone restored pages separately from internal data source pages.

## Definition of Done

* Tests added or updated for the hierarchy derivation.
* Existing lint/type-check/test checks pass.
* No unrelated file churn.
* User can still manually add a page/data source by URL or ID.

## Technical Approach

Use the existing `discovered_content.parent_json` column as the source of truth. Parse `parent_json` into structured parent metadata in the shared API type, then build a display tree on the client. This keeps persistence unchanged and avoids expensive Notion block traversal.

Root-level display groups:

* Normal roots: workspace-level items and items whose parent is outside the discovered cache.
* Nested children: items whose `parentId` matches another returned discovered item.
* Fallback group: items with a known parent that is not currently available in the filtered result set or discovery cache.

## Decision (ADR-lite)

**Context**: Notion search returns discovered objects as a flat result list. The API returns parent metadata, but does not provide a complete workspace tree endpoint.

**Decision**: Implement cached-parent hierarchy first. Do not recursively fetch block children or parent block chains for MVP.

**Consequences**: This improves the common case with minimal API cost. Parent titles for inaccessible or undiscovered parents will not be known yet; those items stay selectable in a fallback group. A later task can add lazy parent-chain enrichment if needed.

## Out of Scope

* Full workspace export or complete Notion tree enumeration.
* Recursive `blocks/{id}/children` crawling during refresh.
* Lazy expansion backed by live Notion API calls.
* Changing backup artifact format or backup execution semantics.

## Research References

* [`research/notion-parent-hierarchy.md`](research/notion-parent-hierarchy.md) — Official Notion APIs provide parent metadata, but hierarchy must be assembled client/server side.

## Technical Notes

* Existing discovery fetch: `src/server/notionClient.ts` `searchAll()`.
* Existing cache: `src/server/repositories/notionRepository.ts` stores `parent_json`.
* Existing UI: `src/client/main.tsx` `DiscoveryPanel` renders a flat `.table` list.
* Shared API type: `src/shared/types.ts` `DiscoveredContent`.

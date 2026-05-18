# Hide deleted Notion items from backup list

## Goal

Notion pages or data sources that have been deleted or moved out of the integration's accessible search results must stop appearing under the UI section labeled "可备份内容" after a connection save or refresh.

## What I already know

- The UI renders "可备份内容" from `GET /api/notion/discovered`.
- `POST /api/notion/connection` and `POST /api/notion/refresh` call `NotionClient.searchAll()` and pass search results into `upsertDiscoveredContent`.
- `upsertDiscoveredContent` inserts or updates returned objects, but it does not remove previously cached rows that are missing from the latest search result.
- Saving a new connection clears the cache first via `saveConnection`; normal refresh does not.

## Assumptions

- For the backup content picker, the canonical list should be the latest Notion search result plus manually added objects that the user explicitly added.
- Automatically discovered search rows missing from a later search are stale and should be hidden or removed.
- Manual additions should not be removed by a broad search refresh, because they may be valid accessible objects that search does not return.

## Requirements

- Refreshing Notion content must remove stale search-discovered items that are no longer returned by Notion search.
- Connection save must keep existing behavior of rebuilding discovered content from the validated search result.
- Manual additions must continue to work and should not be pruned merely because a search response omits them.
- The discovered list API should require no frontend workaround for deleted items.

## Acceptance Criteria

- [ ] If a search-discovered page/data source exists in the cache and the next refresh omits it, it no longer appears in `GET /api/notion/discovered`.
- [ ] If a manually added object exists and the next search refresh omits it, it remains visible.
- [ ] Existing discovered content pagination/counts still reflect only visible rows.
- [ ] Relevant tests pass.

## Definition of Done

- Tests added or updated for stale discovered content pruning.
- Lint/typecheck/tests run where practical.
- No token, session, or backup artifact behavior changes.

## Out of Scope

- Notion API behavior changes or additional Notion endpoints.
- UI redesign of the backup content picker.
- Deleting existing backup plans that reference stale content.

## Technical Notes

- Likely files: `src/server/repositories/notionRepository.ts`, `src/server/routes.ts`, and repository tests.
- The implementation should keep route handlers thin and put cache reconciliation in the repository layer.

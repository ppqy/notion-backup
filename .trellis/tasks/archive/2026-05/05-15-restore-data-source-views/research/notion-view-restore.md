# Notion View Restore Research

Date: 2026-05-15

## Findings

* Official Notion documentation exposes a Create view endpoint at `POST /views`.
* Create view accepts `data_source_id`, `name`, `type`, and optionally `database_id`, `view_id`, `filter`, `sorts`, `quick_filters`, `configuration`, `position`, and dashboard/widget placement fields.
* The installed `@notionhq/client@5.12.0` includes `notion.views.create`, `retrieve`, `update`, `delete`, and `list`.
* The SDK request type currently narrows some view filter/sort fields too aggressively, so the app's existing raw `NotionClient.request` wrapper is the safest local integration point for best-effort restore payloads.
* Create Database responses can include a `database` object with `id` and `data_sources`; Data Source responses include property schema records with new property IDs.

## Implementation Implications

* Restore needs both the new database ID and new data source ID before creating views.
* Property ID remapping can be derived by matching old schema properties to newly created data source properties by property name.
* Restored views should be best-effort. Fields that reference an unmapped old property ID should be omitted or cause the view to be skipped with a warning, depending on whether the field is required.
* The restore report should persist `mappings.views` for successful view creations.

## Sources

* https://developers.notion.com/reference/create-view
* https://developers.notion.com/guides/data-apis/working-with-views
* Local SDK types: `node_modules/@notionhq/client/build/src/Client.d.ts`
* Local SDK types: `node_modules/@notionhq/client/build/src/api-endpoints/views.d.ts`

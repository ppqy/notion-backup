# Notion Views API Research

## Question

How should backup capture Notion data source views so later restore can recreate them from explicit artifacts?

## Sources

* Notion guide: https://developers.notion.com/guides/data-apis/working-with-views
* Notion reference: https://developers.notion.com/reference/list-views
* Installed SDK types: `node_modules/@notionhq/client/build/src/api-endpoints/views.d.ts`

## Findings

* Notion exposes a first-class Views API for data source/database views.
* The list endpoint accepts `data_source_id` and returns view references with pagination.
* Full view configuration requires retrieving each view by ID; the SDK exposes `client.views.retrieve`.
* Full view objects include view type, name, data source ID, filter, sorts, quick filters, configuration, and property references.
* View objects can contain property IDs and optional property names, so raw backup artifacts are useful for later property ID remapping.
* The installed `@notionhq/client` has `client.views.list`, `client.views.retrieve`, `client.views.create`, `client.views.update`, and query helpers.

## Recommended Slice

For the next task, only add backup-time capture:

* List views for each backed-up data source.
* Retrieve and persist full view objects under `data-sources/<data-source-id>/views.json`.
* Add the `data_source_views` manifest capability/artifact kind only when view artifacts are written by new backups.
* Keep restore-side `restoreViews` disabled until a later task adds property mapping and actual view creation.

## Risks

* List results are references, not necessarily complete view configuration.
* Some view configuration may be unsupported or only partially restorable later.
* A failed view retrieval should be visible; silently claiming view support would violate the restore model spec.

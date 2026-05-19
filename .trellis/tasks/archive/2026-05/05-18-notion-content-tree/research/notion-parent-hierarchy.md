# Notion Parent Hierarchy Research

## Question

Can the Notion API support grouped or hierarchical display of discoverable backup targets instead of a flat list?

## Official Sources

* Search endpoint: https://developers.notion.com/reference/post-search
* Search limitations: https://developers.notion.com/reference/search-optimizations-and-limitations
* Parent object: https://developers.notion.com/reference/parent-object
* Page object: https://developers.notion.com/reference/page
* Data source object: https://developers.notion.com/reference/data-source
* Retrieve block: https://developers.notion.com/reference/retrieve-a-block
* Retrieve block children: https://developers.notion.com/reference/get-block-children

## Findings

* The Notion search endpoint returns accessible pages and data sources as a flat paginated list.
* Page and data source objects include a `parent` object. Parent types can include workspace, page, database/data source, or block-style parents depending on object shape and API version.
* The API does not provide a single endpoint that returns a complete accessible workspace tree.
* Official search guidance warns against treating search as a perfect exhaustive workspace enumeration mechanism.
* Block APIs can discover child-page/child-database blocks or retrieve parent chains, but using them for every discovered object would add many requests and increase refresh latency.

## Recommended MVP

Use the already cached `parent_json` from discovery results to build an in-app hierarchy:

* Parse parent type/id into shared API fields.
* If a discovered item parent points to another discovered item, nest it under that parent.
* If the parent is not present, keep the item selectable in an explicit fallback group.
* Avoid recursive block traversal in this task.

## Risks

* If search omits a parent object that the integration can technically access, some children will remain in the fallback group.
* If Notion parent shape changes, parser tests should catch unsupported shapes and fall back gracefully.
* Filtering can hide parents while children match; the UI must still show matching children in a sensible group.

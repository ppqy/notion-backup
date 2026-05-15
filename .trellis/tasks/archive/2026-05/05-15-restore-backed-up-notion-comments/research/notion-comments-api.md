# Notion Comments API Research

Checked on 2026-05-15 against official Notion API references.

## Sources

* Create comment: https://developers.notion.com/reference/create-a-comment
* Retrieve comments: https://developers.notion.com/reference/retrieve-a-comment
* Comment object: https://developers.notion.com/reference/comment-object
* Page object: https://developers.notion.com/reference/page
* Working with comments: https://developers.notion.com/guides/data-apis/working-with-comments
* Connection capabilities: https://developers.notion.com/reference/capabilities

## Findings

* Notion comment endpoints require explicit connection comment capabilities in addition to page/block access.
* Backup needs the connection's `Read comments` capability. Without it, `GET /comments?block_id=<page-or-block-id>` returns a permission error such as `403 Insufficient permissions for this endpoint`.
* Restore needs the connection's `Insert comments` capability to recreate comments through `POST /comments`.
* Notion comments can be created by passing a parent page/block target plus rich text, or by replying to an existing discussion when a `discussion_id` is available.
* Backed-up comments should be restored as new comments. The API does not allow preserving the original author, creation time, last edited time, resolved state, or original comment ID.
* The restore path should target the restored page or restored block when the backup comment carries a target reference that can be mapped through `report.mappings.pages` or `report.mappings.blocks`.
* If a comment only has a discussion/thread reference and that discussion cannot be mapped to a newly created comment/discussion, restore should warn and skip it.
* Rich text should be sanitized through the existing restore rich text path so response-only fields and unsupported mentions do not get sent back to Notion.
* Create failures should be per-comment warnings. They should not fail the whole page/data source restore unless the broader restore item already failed.

## Implementation Implications

* Add a Notion client wrapper for `POST /comments`.
* Preserve comment backup permission failures as structured page artifact metadata so restore preflight can explain missing comments without requiring users to inspect `logs.jsonl`.
* Add a comment conversion helper that extracts a safe parent target and rich text body from stored comment payloads.
* Run comment restore after page/block creation so target mappings are available.
* Record `mappings.comments[oldCommentId] = newCommentId` when Notion returns a new comment ID.
* Increment `summary.createdComments`.
* Keep comment restore behind explicit `restoreComments: true`.

## Non-Goals

* Reconstructing exact discussions/threads when Notion does not provide a targetable mapping.
* Preserving historical authorship or timestamps.
* Restoring comments for source objects that were not restored in the same run.

# File upload restore research

Date: 2026-05-15

## Question

How should restore attach files that were downloaded during backup back into Notion?

## Sources

* Notion File Upload object/reference: https://developers.notion.com/reference/file-upload
* Create a file upload: https://developers.notion.com/reference/create-a-file-upload
* Send a file upload: https://developers.notion.com/reference/send-a-file-upload
* Complete a file upload: https://developers.notion.com/reference/complete-a-file-upload
* File object reference: https://developers.notion.com/reference/file-object
* Local SDK types: `node_modules/@notionhq/client/build/src/api-endpoints/file-uploads.d.ts`

## Findings

* A File Upload object moves through `pending`, `uploaded`, `expired`, or `failed`.
* After status is `uploaded`, the restore can attach it by sending a file object with `type: "file_upload"` and `file_upload: { id }`.
* Small files can use `mode: "single_part"` then `fileUploads.send` with multipart form data.
* `complete` is for `mode: "multi_part"` uploads after all parts have been sent.
* Notion documents 20 MiB as the threshold where multipart upload is required.
* The current repo already stores downloaded asset metadata in `assets/<page-id>/manifest.json`, with the original candidate URL and local downloaded path.

## Implementation Direction

1. Build a per-page asset lookup from `assets/<page-id>/manifest.json`.
2. Match original Notion-hosted file URLs in block/property payloads to downloaded asset manifest entries.
3. For downloaded assets at or below 20 MiB, create a single-part File Upload, send local bytes, and attach as `file_upload`.
4. Cache upload IDs by original URL or local path for the restore run.
5. Keep warnings for missing manifests, skipped downloads, missing files, or files requiring multipart.

## Follow-ups

* Add multipart upload support for large downloaded files.
* Consider file-backed page icons/covers after block/property files are stable.
* Consider optional external URL import mode separately from restoring already downloaded assets.

export const NOTION_TOKEN_PREFIX = "ntn_";
export const NOTION_DEVELOPER_PORTAL_URL = "https://www.notion.so/developers";
export const ADMIN_USERNAME_MIN_LENGTH = 3;
export const PASSWORD_MIN_LENGTH = 8;

export const BACKUP_MANIFEST_SCHEMA_VERSION = 2;
export const LEGACY_BACKUP_MANIFEST_SCHEMA_VERSION = 1;

export const BACKUP_MANIFEST_CAPABILITY = {
  PageJson: "page_json",
  PageBlocks: "page_blocks",
  PagePropertyItems: "page_property_items",
  PageComments: "page_comments",
  DataSourceJson: "data_source_json",
  DataSourceEntries: "data_source_entries",
  Markdown: "markdown",
  LocalFileAssets: "local_file_assets",
  ExternalFileAssets: "external_file_assets",
  DataSourceViews: "data_source_views"
} as const;

export const BACKUP_ARTIFACT_KIND = {
  Manifest: "manifest",
  Logs: "logs",
  PageJson: "page_json",
  DataSourceSchema: "data_source_schema",
  DataSourceEntries: "data_source_entries",
  DataSourceViews: "data_source_views",
  Markdown: "markdown",
  AssetManifest: "asset_manifest",
  AssetFile: "asset_file"
} as const;

export const DEFAULT_RESTORE_OPTIONS = {
  restoreComments: false,
  restoreViews: false,
  importExternalUrls: false,
  relationStrategy: "mapped_only"
} as const;

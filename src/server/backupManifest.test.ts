import { describe, expect, it } from "vitest";
import { BACKUP_ARTIFACT_KIND, BACKUP_MANIFEST_CAPABILITY, BACKUP_MANIFEST_SCHEMA_VERSION, LEGACY_BACKUP_MANIFEST_SCHEMA_VERSION } from "../shared/constants.js";
import { backupManifestMetadataForPlan, normalizeBackupManifest } from "./backupManifest.js";

describe("backup manifest metadata", () => {
  it("writes current schema metadata without claiming data source views for page-only plans", () => {
    const metadata = backupManifestMetadataForPlan({
      includeComments: true,
      downloadNotionFiles: true,
      mirrorExternalFiles: false,
      selectedContent: [{ objectId: "page-1", objectType: "page", title: "Page" }]
    });

    expect(metadata.schemaVersion).toBe(BACKUP_MANIFEST_SCHEMA_VERSION);
    expect(metadata.capabilities).toContain(BACKUP_MANIFEST_CAPABILITY.PageJson);
    expect(metadata.capabilities).toContain(BACKUP_MANIFEST_CAPABILITY.PageComments);
    expect(metadata.capabilities).toContain(BACKUP_MANIFEST_CAPABILITY.LocalFileAssets);
    expect(metadata.capabilities).not.toContain(BACKUP_MANIFEST_CAPABILITY.DataSourceViews);
    expect(metadata.artifactKinds).toContain(BACKUP_ARTIFACT_KIND.AssetManifest);
    expect(metadata.artifactKinds).not.toContain(BACKUP_ARTIFACT_KIND.DataSourceViews);
  });

  it("claims data source view artifacts for data source backup plans", () => {
    const metadata = backupManifestMetadataForPlan({
      includeComments: false,
      downloadNotionFiles: false,
      mirrorExternalFiles: false,
      selectedContent: [{ objectId: "data-source-1", objectType: "data_source", title: "Data source" }]
    });

    expect(metadata.schemaVersion).toBe(BACKUP_MANIFEST_SCHEMA_VERSION);
    expect(metadata.capabilities).toContain(BACKUP_MANIFEST_CAPABILITY.DataSourceViews);
    expect(metadata.artifactKinds).toContain(BACKUP_ARTIFACT_KIND.DataSourceViews);
  });

  it("treats manifests without schemaVersion as legacy v1 with safe defaults", () => {
    expect(normalizeBackupManifest({ runId: "old-run" })).toEqual({
      schemaVersion: LEGACY_BACKUP_MANIFEST_SCHEMA_VERSION,
      capabilities: [],
      artifactKinds: [],
      legacy: true
    });
  });
});

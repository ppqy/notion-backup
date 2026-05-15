import { describe, expect, it } from "vitest";
import { BACKUP_ARTIFACT_KIND, BACKUP_MANIFEST_CAPABILITY, BACKUP_MANIFEST_SCHEMA_VERSION, LEGACY_BACKUP_MANIFEST_SCHEMA_VERSION } from "../shared/constants.js";
import { backupManifestMetadataForPlan, normalizeBackupManifest } from "./backupManifest.js";

describe("backup manifest metadata", () => {
  it("writes current schema metadata without claiming future view artifacts", () => {
    const metadata = backupManifestMetadataForPlan({
      includeComments: true,
      downloadNotionFiles: true,
      mirrorExternalFiles: false
    });

    expect(metadata.schemaVersion).toBe(BACKUP_MANIFEST_SCHEMA_VERSION);
    expect(metadata.capabilities).toContain(BACKUP_MANIFEST_CAPABILITY.PageJson);
    expect(metadata.capabilities).toContain(BACKUP_MANIFEST_CAPABILITY.PageComments);
    expect(metadata.capabilities).toContain(BACKUP_MANIFEST_CAPABILITY.LocalFileAssets);
    expect(metadata.capabilities).not.toContain(BACKUP_MANIFEST_CAPABILITY.DataSourceViews);
    expect(metadata.artifactKinds).toContain(BACKUP_ARTIFACT_KIND.AssetManifest);
    expect(metadata.artifactKinds).not.toContain(BACKUP_ARTIFACT_KIND.DataSourceViews);
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

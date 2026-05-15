import { readFileSync } from "node:fs";
import {
  BACKUP_ARTIFACT_KIND,
  BACKUP_MANIFEST_CAPABILITY,
  BACKUP_MANIFEST_SCHEMA_VERSION,
  LEGACY_BACKUP_MANIFEST_SCHEMA_VERSION
} from "../shared/constants.js";
import type { BackupArtifactKind, BackupManifestCapability, BackupManifestMetadata, BackupPlan } from "../shared/types.js";

const KNOWN_CAPABILITIES = new Set<string>(Object.values(BACKUP_MANIFEST_CAPABILITY));
const KNOWN_ARTIFACT_KINDS = new Set<string>(Object.values(BACKUP_ARTIFACT_KIND));

export function backupManifestMetadataForPlan(
  plan: Pick<BackupPlan, "includeComments" | "downloadNotionFiles" | "mirrorExternalFiles">
): Omit<BackupManifestMetadata, "legacy"> {
  const capabilities: BackupManifestCapability[] = [
    BACKUP_MANIFEST_CAPABILITY.PageJson,
    BACKUP_MANIFEST_CAPABILITY.PageBlocks,
    BACKUP_MANIFEST_CAPABILITY.PagePropertyItems,
    BACKUP_MANIFEST_CAPABILITY.DataSourceJson,
    BACKUP_MANIFEST_CAPABILITY.DataSourceEntries,
    BACKUP_MANIFEST_CAPABILITY.Markdown
  ];
  const artifactKinds: BackupArtifactKind[] = [
    BACKUP_ARTIFACT_KIND.Manifest,
    BACKUP_ARTIFACT_KIND.Logs,
    BACKUP_ARTIFACT_KIND.PageJson,
    BACKUP_ARTIFACT_KIND.DataSourceSchema,
    BACKUP_ARTIFACT_KIND.DataSourceEntries,
    BACKUP_ARTIFACT_KIND.Markdown
  ];

  if (plan.includeComments) {
    capabilities.push(BACKUP_MANIFEST_CAPABILITY.PageComments);
  }
  if (plan.downloadNotionFiles) {
    capabilities.push(BACKUP_MANIFEST_CAPABILITY.LocalFileAssets);
    artifactKinds.push(BACKUP_ARTIFACT_KIND.AssetManifest, BACKUP_ARTIFACT_KIND.AssetFile);
  }
  if (plan.mirrorExternalFiles) {
    capabilities.push(BACKUP_MANIFEST_CAPABILITY.ExternalFileAssets);
    if (!artifactKinds.includes(BACKUP_ARTIFACT_KIND.AssetManifest)) {
      artifactKinds.push(BACKUP_ARTIFACT_KIND.AssetManifest, BACKUP_ARTIFACT_KIND.AssetFile);
    }
  }

  return {
    schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
    capabilities,
    artifactKinds
  };
}

export function readBackupManifestMetadata(filePath: string): BackupManifestMetadata {
  return normalizeBackupManifest(JSON.parse(readFileSync(filePath, "utf8")));
}

export function normalizeBackupManifest(value: unknown): BackupManifestMetadata {
  const record = isRecord(value) ? value : {};
  const rawVersion = record.schemaVersion;
  const hasExplicitVersion = typeof rawVersion === "number" && Number.isInteger(rawVersion) && rawVersion > 0;

  return {
    schemaVersion: hasExplicitVersion ? rawVersion : LEGACY_BACKUP_MANIFEST_SCHEMA_VERSION,
    capabilities: readKnownStrings(record.capabilities, KNOWN_CAPABILITIES) as BackupManifestCapability[],
    artifactKinds: readKnownStrings(record.artifactKinds, KNOWN_ARTIFACT_KINDS) as BackupArtifactKind[],
    legacy: !hasExplicitVersion
  };
}

function readKnownStrings(value: unknown, knownValues: Set<string>): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && knownValues.has(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

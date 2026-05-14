import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { config } from "./config.js";

export function ensureBackupRoot(): void {
  mkdirSync(path.join(config.backupRoot, "runs"), { recursive: true });
}

export function runArtifactDir(runKey: string): string {
  return path.join(config.backupRoot, "runs", safeSegment(runKey));
}

export function ensureRunDirs(root: string): void {
  for (const directory of ["pages", "data-sources", "markdown", "assets"]) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  mkdirSync(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(filePath: string, value: string): Promise<void> {
  mkdirSync(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

export function directorySizeBytes(directory: string): number {
  if (!existsSync(directory)) {
    return 0;
  }
  let total = 0;
  for (const name of readdirSync(directory)) {
    const child = path.join(directory, name);
    const stats = statSync(child);
    total += stats.isDirectory() ? directorySizeBytes(child) : stats.size;
  }
  return total;
}

export async function generateZip(runDir: string): Promise<string> {
  const archivePath = path.join(runDir, "archive.zip");
  if (existsSync(archivePath)) {
    return archivePath;
  }
  const output = createWriteStream(archivePath);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(output);
  archive.glob("**/*", {
    cwd: runDir,
    ignore: ["archive.zip"]
  });
  await archive.finalize();
  await new Promise<void>((resolve, reject) => {
    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
  });
  return archivePath;
}

export async function removePath(pathToRemove: string): Promise<void> {
  await rm(pathToRemove, { recursive: true, force: true });
}

export function assertUnderBackupRoot(filePath: string): void {
  const resolvedRoot = path.resolve(config.backupRoot);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(resolvedRoot)) {
    throw new Error("Path is outside backup root");
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

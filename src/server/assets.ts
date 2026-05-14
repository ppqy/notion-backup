import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { nanoid } from "nanoid";

export type AssetCandidate = {
  url: string;
  kind: "notion" | "external";
  name: string;
};

export type DownloadResult =
  | { status: "downloaded"; path: string; bytes: number; candidate: AssetCandidate }
  | { status: "skipped"; reason: string; candidate: AssetCandidate };

export function collectAssets(value: unknown): AssetCandidate[] {
  const results: AssetCandidate[] = [];
  walk(value, results);
  const seen = new Set<string>();
  return results.filter((candidate) => {
    if (seen.has(candidate.url)) {
      return false;
    }
    seen.add(candidate.url);
    return true;
  });
}

export async function downloadAsset(candidate: AssetCandidate, outputDir: string, limitBytes: number | null): Promise<DownloadResult> {
  const response = await fetch(candidate.url);
  if (!response.ok || !response.body) {
    return {
      status: "skipped",
      reason: `下载失败：HTTP ${response.status}`,
      candidate
    };
  }
  const contentLength = response.headers.get("content-length");
  if (limitBytes !== null && contentLength && Number.parseInt(contentLength, 10) > limitBytes) {
    return {
      status: "skipped",
      reason: `超过单文件大小限制 ${limitBytes} bytes`,
      candidate
    };
  }
  await mkdir(outputDir, { recursive: true });
  const safeName = sanitizeFileName(candidate.name || `${nanoid(8)}.bin`);
  const target = path.join(outputDir, `${nanoid(6)}_${safeName}`);
  let bytes = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (limitBytes !== null && bytes > limitBytes) {
        throw new Error(`超过单文件大小限制 ${limitBytes} bytes`);
      }
      controller.enqueue(chunk);
    }
  });

  try {
    const stream = response.body.pipeThrough(limiter);
    await pipeline(Readable.fromWeb(stream as unknown as NodeReadableStream<Uint8Array>), createWriteStream(target));
    return {
      status: "downloaded",
      path: target,
      bytes,
      candidate
    };
  } catch (error) {
    return {
      status: "skipped",
      reason: error instanceof Error ? error.message : "下载失败",
      candidate
    };
  }
}

function walk(value: unknown, results: AssetCandidate[]): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, results);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const type = record.type;
  if (type === "file" && record.file && typeof record.file === "object") {
    const file = record.file as { url?: string };
    if (file.url) {
      results.push({
        url: file.url,
        kind: "notion",
        name: extractName(file.url)
      });
    }
  }
  if (type === "external" && record.external && typeof record.external === "object") {
    const external = record.external as { url?: string };
    if (external.url) {
      results.push({
        url: external.url,
        kind: "external",
        name: extractName(external.url)
      });
    }
  }

  for (const item of Object.values(record)) {
    walk(item, results);
  }
}

function extractName(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).at(-1);
    return last || "asset.bin";
  } catch {
    return "asset.bin";
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120) || "asset.bin";
}

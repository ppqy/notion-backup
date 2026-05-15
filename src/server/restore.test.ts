import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BackupRunDetail, BackupRunItem } from "../shared/types.js";
import { collectPageArtifactRestoreWarnings, convertBlockForRestore, resolveRestoreStatus, validateRestorePreflight } from "./restore.js";

describe("restore block conversion", () => {
  it("converts paragraph rich text without response-only fields", () => {
    const conversion = convertBlockForRestore({
      id: "block-1",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: { content: "Hello", link: null },
            annotations: { bold: true },
            plain_text: "Hello",
            href: null
          }
        ],
        color: "default"
      }
    });

    expect(conversion.action).toBe("append");
    if (conversion.action === "append") {
      expect(conversion.request).toEqual({
        type: "paragraph",
        paragraph: {
          rich_text: [
            {
              type: "text",
              text: { content: "Hello" },
              annotations: { bold: true }
            }
          ],
          color: "default"
        }
      });
    }
  });

  it("downgrades unsupported rich text mentions to plain text with a warning", () => {
    const conversion = convertBlockForRestore({
      id: "block-2",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "mention", plain_text: "@Old page", mention: { type: "page", page: { id: "old" } } }],
        color: "default"
      }
    });

    expect(conversion.action).toBe("append");
    expect(conversion.warnings).toEqual([
      {
        code: "rich_text_mention_downgraded",
        message: "富文本 mention 或暂不支持类型已降级为普通文本"
      }
    ]);
    if (conversion.action === "append") {
      expect(conversion.request).toMatchObject({
        paragraph: {
          rich_text: [{ type: "text", text: { content: "@Old page" } }]
        }
      });
    }
  });

  it("marks child page blocks for recursive page restore", () => {
    const conversion = convertBlockForRestore({
      id: "child-page-id",
      type: "child_page",
      child_page: {
        title: "Nested"
      }
    });

    expect(conversion).toEqual({
      action: "restore_child_page",
      childPageId: "child-page-id",
      title: "Nested",
      warnings: []
    });
  });

  it("skips Notion-hosted file blocks until file upload restore is implemented", () => {
    const conversion = convertBlockForRestore({
      id: "file-block",
      type: "file",
      file: {
        type: "file",
        file: {
          url: "https://secure.notion-static.com/file.pdf"
        },
        caption: []
      }
    });

    expect(conversion.action).toBe("skip");
    expect(conversion.warnings[0]?.code).toBe("local_file_upload_not_implemented");
  });

  it("preserves external media URLs", () => {
    const conversion = convertBlockForRestore({
      id: "image-block",
      type: "image",
      image: {
        type: "external",
        external: {
          url: "https://example.com/image.png"
        },
        caption: []
      }
    });

    expect(conversion.action).toBe("append");
    if (conversion.action === "append") {
      expect(conversion.request).toEqual({
        type: "image",
        image: {
          type: "external",
          external: {
            url: "https://example.com/image.png"
          },
          caption: []
        }
      });
    }
  });

  it("keeps table width and embeds backed-up rows in table create payload", () => {
    const conversion = convertBlockForRestore({
      id: "table-block",
      type: "table",
      table: {
        table_width: 3,
        has_column_header: true,
        has_row_header: false
      },
      children: [
        {
          id: "row-1",
          type: "table_row",
          table_row: {
            cells: [[{ type: "text", text: { content: "Cell", link: null }, plain_text: "Cell" }]]
          }
        }
      ]
    });

    expect(conversion.action).toBe("append");
    if (conversion.action === "append") {
      expect(conversion.request).toMatchObject({
        table: {
          table_width: 3,
          has_column_header: true,
          has_row_header: false,
          children: [
            {
              type: "table_row",
              table_row: {
                cells: [[{ type: "text", text: { content: "Cell" } }]]
              }
            }
          ]
        }
      });
    }
  });
});

describe("restore artifact warnings", () => {
  it("warns for skipped non-title page properties and comments", () => {
    const warnings = collectPageArtifactRestoreWarnings(
      {
        page: {
          properties: {
            Name: { type: "title", title: [] },
            Status: { type: "select", select: { name: "Open" } },
            Related: { type: "relation", relation: [] },
            Created: { type: "created_time", created_time: "2026-05-15T00:00:00.000Z" }
          }
        },
        comments: {
          results: [{ id: "comment-1" }]
        }
      },
      "page-1"
    );

    expect(warnings.map((warning) => warning.code)).toEqual([
      "page_property_skipped",
      "relation_property_skipped",
      "read_only_property_skipped",
      "comments_restore_not_implemented"
    ]);
  });
});

describe("restore preflight", () => {
  it("requires an artifact directory and manifest", async () => {
    await expect(validateRestorePreflight(fakeRun({ artifactDir: null }))).rejects.toThrow("备份文件不存在");

    const runDir = await mkdtemp(path.join(tmpdir(), "restore-preflight-"));
    await expect(validateRestorePreflight(fakeRun({ artifactDir: runDir }))).rejects.toThrow("manifest 不存在，无法恢复");
  });

  it("requires a completed backup run with at least one successful item", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "restore-preflight-"));
    await writeFile(path.join(runDir, "manifest.json"), "{}\n", "utf8");

    await expect(validateRestorePreflight(fakeRun({ artifactDir: runDir, status: "running" }))).rejects.toThrow("只有成功或部分失败的备份运行可以恢复");
    await expect(validateRestorePreflight(fakeRun({ artifactDir: runDir, items: [{ ...successfulItem(), status: "failed" }] }))).rejects.toThrow(
      "没有可恢复的成功备份项目"
    );
    await expect(validateRestorePreflight(fakeRun({ artifactDir: runDir }))).resolves.toBeUndefined();
  });
});

describe("restore report status", () => {
  it("marks skipped-only restores as failed and mixed restores as partial", () => {
    expect(resolveRestoreStatus({ createdPages: 0, failedItems: 0, skippedItems: 1, errorCount: 0 })).toBe("failed");
    expect(resolveRestoreStatus({ createdPages: 1, failedItems: 0, skippedItems: 1, errorCount: 0 })).toBe("partial_failed");
  });
});

function fakeRun(overrides: Partial<Pick<BackupRunDetail, "artifactDir" | "status" | "items">>): Pick<BackupRunDetail, "artifactDir" | "status" | "items"> {
  return {
    artifactDir: "/tmp/does-not-exist",
    status: "succeeded",
    items: [successfulItem()],
    ...overrides
  };
}

function successfulItem(): BackupRunItem {
  return {
    id: "item-1",
    objectId: "page-1",
    objectType: "page",
    title: "Page",
    status: "succeeded",
    errorMessage: null,
    artifactPath: "pages/page-1.json",
    startedAt: null,
    finishedAt: null
  };
}

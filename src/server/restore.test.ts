import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BackupRunDetail, BackupRunItem } from "../shared/types.js";
import {
  collectPageArtifactRestoreWarnings,
  convertBlockForRestore,
  convertDataSourcePropertiesForRestore,
  convertPagePropertiesForRestore,
  resolveRestoreStatus,
  safeUploadFileName,
  summarizeRestorePreflight,
  validateRestorePreflight
} from "./restore.js";

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

  it("skips Notion-hosted file blocks when no backed-up asset resolver is available", () => {
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

  it("restores Notion-hosted file blocks when a file upload resolver returns an upload", () => {
    const conversion = convertBlockForRestore(
      {
        id: "file-block",
        type: "file",
        file: {
          type: "file",
          file: {
            url: "https://secure.notion-static.com/file.pdf"
          },
          caption: [{ type: "text", text: { content: "Spec" }, plain_text: "Spec" }]
        }
      },
      {
        fileResolver: () => ({
          type: "file_upload",
          file_upload: {
            id: "upload-1"
          }
        })
      }
    );

    expect(conversion.action).toBe("append");
    if (conversion.action === "append") {
      expect(conversion.request).toEqual({
        type: "file",
        file: {
          type: "file_upload",
          file_upload: {
            id: "upload-1"
          },
          caption: [{ type: "text", text: { content: "Spec" } }]
        }
      });
    }
  });

  it("keeps asset restore warnings when a file upload resolver cannot upload", () => {
    const conversion = convertBlockForRestore(
      {
        id: "image-block",
        type: "image",
        image: {
          type: "file",
          file: {
            url: "https://secure.notion-static.com/image.png"
          },
          caption: []
        }
      },
      {
        fileResolver: (_file, warnings) => {
          warnings.push({
            code: "asset_manifest_missing",
            message: "本地资产 manifest 不存在，无法上传恢复文件"
          });
          return null;
        }
      }
    );

    expect(conversion.action).toBe("skip");
    expect(conversion.warnings[0]?.code).toBe("asset_manifest_missing");
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

describe("restore data source schema conversion", () => {
  it("keeps writable schema properties and warns for unsupported relation schema", () => {
    const conversion = convertDataSourcePropertiesForRestore(
      {
        Name: { type: "title", title: {} },
        Status: {
          type: "status",
          status: {
            options: [
              {
                id: "old-option",
                name: "Open",
                color: "green",
                description: "Ready"
              }
            ],
            groups: []
          }
        },
        Score: { type: "number", number: { format: "number" } },
        Related: { type: "relation", relation: { data_source_id: "old-ds" } }
      },
      "data-source-1"
    );

    expect(conversion.properties).toEqual({
      Name: { title: {} },
      Status: {
        status: {
          options: [
            {
              name: "Open",
              color: "green",
              description: "Ready"
            }
          ]
        }
      },
      Score: { number: { format: "number" } }
    });
    expect(conversion.warnings.map((warning) => warning.code)).toEqual(["relation_schema_skipped"]);
  });

  it("adds a default title schema when the backup schema has no title property", () => {
    const conversion = convertDataSourcePropertiesForRestore({
      Done: { type: "checkbox", checkbox: {} }
    });

    expect(conversion.properties).toMatchObject({
      Done: { checkbox: {} },
      Name: { title: {} }
    });
    expect(conversion.warnings[0]?.code).toBe("data_source_title_schema_added");
  });
});

describe("restore page property conversion", () => {
  it("restores writable property values with response-only fields removed", () => {
    const conversion = convertPagePropertiesForRestore({
      sourceProperties: {
        Name: { type: "title", title: [{ type: "text", text: { content: "Fallback", link: null }, plain_text: "Fallback", href: null }] },
        Status: { type: "status", status: { id: "status-id", name: "Open", color: "green" } },
        Tags: {
          type: "multi_select",
          multi_select: [
            {
              id: "tag-id",
              name: "Important",
              color: "red"
            }
          ]
        },
        Score: { type: "number", number: 7 },
        Done: { type: "checkbox", checkbox: true },
        Due: { type: "date", date: { start: "2026-05-15", end: null, time_zone: null } },
        Link: { type: "url", url: "https://example.com" },
        File: {
          type: "files",
          files: [
            {
              type: "external",
              name: "spec",
              external: { url: "https://example.com/spec.pdf" }
            },
            {
              type: "file",
              name: "local",
              file: { url: "https://secure.notion-static.com/local.pdf" }
            }
          ]
        },
        Created: { type: "created_time", created_time: "2026-05-15T00:00:00.000Z" }
      },
      propertyItems: {
        Name: {
          object: "list",
          results: [
            { object: "property_item", type: "title", title: { type: "text", text: { content: "Full", link: null }, plain_text: "Full" } },
            { object: "property_item", type: "title", title: { type: "text", text: { content: " title", link: null }, plain_text: " title" } }
          ]
        }
      },
      fallbackTitle: "Fallback",
      pageId: "page-1"
    });

    expect(conversion.properties).toMatchObject({
      Name: {
        title: [
          { type: "text", text: { content: "Full" } },
          { type: "text", text: { content: " title" } }
        ]
      },
      Status: { status: { name: "Open", color: "green" } },
      Tags: { multi_select: [{ name: "Important", color: "red" }] },
      Score: { number: 7 },
      Done: { checkbox: true },
      Due: { date: { start: "2026-05-15", end: null, time_zone: null } },
      Link: { url: "https://example.com" },
      File: { files: [{ type: "external", name: "spec", external: { url: "https://example.com/spec.pdf" } }] }
    });
    expect(conversion.warnings.map((warning) => warning.code)).toEqual(["file_property_upload_not_implemented", "read_only_property_skipped"]);
  });

  it("maps relation values only when restored page mappings exist", () => {
    const conversion = convertPagePropertiesForRestore({
      sourceProperties: {
        Name: { type: "title", title: [] },
        Related: {
          type: "relation",
          relation: [{ id: "old-page-1" }, { id: "old-page-2" }]
        }
      },
      fallbackTitle: "Task",
      pageId: "page-1",
      pageMappings: {
        "old-page-1": "new-page-1"
      }
    });

    expect(conversion.properties.Related).toEqual({
      relation: [{ id: "new-page-1" }]
    });
    expect(conversion.warnings[0]?.code).toBe("relation_property_unresolved");
  });

  it("restores file properties with file upload objects from the resolver", () => {
    const conversion = convertPagePropertiesForRestore({
      sourceProperties: {
        Name: { type: "title", title: [{ type: "text", text: { content: "Doc", link: null }, plain_text: "Doc" }] },
        File: {
          type: "files",
          files: [
            {
              type: "file",
              name: "doc.pdf",
              file: { url: "https://secure.notion-static.com/doc.pdf" }
            }
          ]
        }
      },
      fallbackTitle: "Doc",
      pageId: "page-1",
      fileResolver: () => ({
        type: "file_upload",
        file_upload: {
          id: "upload-1"
        }
      })
    });

    expect(conversion.properties.File).toEqual({
      files: [
        {
          type: "file_upload",
          name: "doc.pdf",
          file_upload: {
            id: "upload-1"
          }
        }
      ]
    });
    expect(conversion.warnings).toEqual([]);
  });

  it("skips values that are not present in the restored data source schema", () => {
    const conversion = convertPagePropertiesForRestore({
      sourceProperties: {
        Name: { type: "title", title: [] },
        Related: {
          type: "relation",
          relation: [{ id: "old-page-1" }]
        }
      },
      fallbackTitle: "Task",
      allowedPropertyNames: new Set(["Name"])
    });

    expect(conversion.properties).toEqual({
      Name: { title: [{ type: "text", text: { content: "Task" } }] }
    });
    expect(conversion.warnings[0]?.code).toBe("page_property_schema_missing");
  });
});

describe("restore file upload filenames", () => {
  it("preserves Chinese filenames while removing path-unsafe characters", () => {
    expect(safeUploadFileName("会议纪要/第1版?.pdf")).toBe("会议纪要_第1版_.pdf");
    expect(safeUploadFileName("____.pdf")).toBe("____.pdf");
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

  it("summarizes restorable items and artifact warnings without writing to Notion", async () => {
    const runDir = await mkdtemp(path.join(tmpdir(), "restore-summary-"));
    await writeFile(path.join(runDir, "manifest.json"), "{}\n", "utf8");
    const summary = summarizeRestorePreflight(
      {
        id: "run-1",
        runKey: "run-key",
        artifactDir: runDir,
        items: [
          successfulItem(),
          {
            ...successfulItem(),
            id: "item-2",
            objectId: "data-source-1",
            objectType: "data_source",
            title: "Data source"
          },
          {
            ...successfulItem(),
            id: "item-3",
            objectId: "failed-page",
            title: "Failed page",
            status: "failed"
          }
        ]
      },
      "target-parent"
    );

    expect(summary).toMatchObject({
      sourceRunId: "run-1",
      sourceRunKey: "run-key",
      targetParentId: "target-parent",
      totalItems: 3,
      restorableItems: 2,
      skippedItems: 1,
      pages: 1,
      dataSources: 1
    });
    expect(summary.warnings.map((warning) => warning.code)).toContain("page_artifact_missing");
    expect(summary.warnings.map((warning) => warning.code)).toContain("data_source_schema_missing");
    expect(summary.warnings.map((warning) => warning.code)).toContain("restore_item_skipped");
    expect(summary.warnings.map((warning) => warning.code)).toContain("restore_creates_new_content");
  });
});

describe("restore report status", () => {
  it("marks skipped-only restores as failed and mixed restores as partial", () => {
    expect(resolveRestoreStatus({ createdPages: 0, failedItems: 0, skippedItems: 1, errorCount: 0 })).toBe("failed");
    expect(resolveRestoreStatus({ createdPages: 1, failedItems: 0, skippedItems: 1, errorCount: 0 })).toBe("partial_failed");
    expect(resolveRestoreStatus({ createdPages: 0, createdDataSources: 1, failedItems: 0, skippedItems: 0, errorCount: 1 })).toBe("partial_failed");
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

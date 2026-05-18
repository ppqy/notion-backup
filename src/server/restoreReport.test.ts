import { describe, expect, it } from "vitest";
import { DEFAULT_RESTORE_OPTIONS } from "../shared/constants.js";
import { normalizeRestoreReport, parseRestoreOptionsJson, parseRestoreSummaryJson } from "./restoreReport.js";
import { summarizeRestoreWarnings } from "./restoreWarnings.js";

describe("restore report compatibility", () => {
  it("defaults missing future mapping and summary fields from old manifests", () => {
    const report = normalizeRestoreReport({
      restoreId: "restore-1",
      sourceRunId: "run-1",
      sourceRunKey: "run-key",
      targetParentId: "target-parent",
      status: "succeeded",
      startedAt: "2026-05-15T00:00:00.000Z",
      finishedAt: "2026-05-15T00:01:00.000Z",
      summary: {
        createdPages: 1
      },
      mappings: {
        pages: {
          "old-page": "new-page"
        }
      },
      items: [],
      warnings: [
        {
          code: "page_comments_missing",
          message: "页面没有备份评论，恢复时会跳过评论",
          objectId: "old-page"
        }
      ],
      errors: [],
      manifestPath: "restore-manifest.json"
    });

    expect(report?.options).toEqual(DEFAULT_RESTORE_OPTIONS);
    expect(report?.summary).toMatchObject({
      createdPages: 1,
      createdDataSources: 0,
      createdBlocks: 0,
      createdViews: 0,
      createdComments: 0,
      skippedItems: 0,
      failedItems: 0,
      warningCount: 1
    });
    expect(report?.mappings.pages).toEqual({ "old-page": "new-page" });
    expect(report?.mappings.properties).toEqual({});
    expect(report?.mappings.views).toEqual({});
    expect(report?.mappings.comments).toEqual({});
    expect(report?.warningSummaries).toMatchObject([
      {
        code: "page_comments_missing",
        severity: "warning",
        count: 1,
        examples: [
          {
            objectId: "old-page"
          }
        ]
      }
    ]);
  });

  it("parses stored restore options and summary JSON defensively", () => {
    expect(parseRestoreOptionsJson(null)).toEqual(DEFAULT_RESTORE_OPTIONS);
    expect(parseRestoreOptionsJson('{"restoreComments":false,"restoreViews":false,"importExternalUrls":false,"relationStrategy":"mapped_only"}')).toEqual(DEFAULT_RESTORE_OPTIONS);
    expect(parseRestoreSummaryJson('{"createdPages":2,"createdViews":3,"createdComments":4}')).toMatchObject({
      createdPages: 2,
      createdViews: 3,
      createdComments: 4,
      createdDataSources: 0,
      warningCount: 0
    });
  });

  it("groups repeated restore warnings and separates informational notices", () => {
    const summaries = summarizeRestoreWarnings([
      {
        code: "page_comments_missing",
        message: "页面没有备份评论，恢复时会跳过评论：Page A",
        objectId: "page-a"
      },
      {
        code: "page_comments_missing",
        message: "页面没有备份评论，恢复时会跳过评论：Page B",
        objectId: "page-b"
      },
      {
        code: "restore_creates_new_content",
        message: "恢复会创建新的 Notion 页面和数据源，不会覆盖或回滚原内容"
      }
    ]);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      code: "page_comments_missing",
      severity: "warning",
      title: "页面评论缺失",
      count: 2,
      examples: [
        {
          message: "页面没有备份评论，恢复时会跳过评论：Page A",
          objectId: "page-a"
        },
        {
          message: "页面没有备份评论，恢复时会跳过评论：Page B",
          objectId: "page-b"
        }
      ]
    });
    expect(summaries[1]).toMatchObject({
      code: "restore_creates_new_content",
      severity: "info",
      count: 1
    });
  });
});

import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  collectPageCommentsArtifact,
  collectDataSourceViewsArtifact,
  DATA_SOURCE_VIEWS_ARTIFACT_FILENAME,
  writeDataSourceViewsArtifact
} from "./backupWorker.js";
import { NotionApiError } from "./notionClient.js";

describe("data source view backup artifacts", () => {
  it("paginates view references, retrieves full views, and writes views.json", async () => {
    const notion = {
      listDataSourceViews: vi.fn(async (_dataSourceId: string, startCursor?: string) => {
        if (startCursor === "next-page") {
          return {
            results: [{ id: "view-2" }],
            has_more: false,
            next_cursor: null
          };
        }
        return {
          results: [{ id: "view-1" }],
          has_more: true,
          next_cursor: "next-page"
        };
      }),
      retrieveView: vi.fn(async (viewId: string) => ({
        object: "view",
        id: viewId,
        name: `View ${viewId}`,
        filter: { property_id: "old-property-id" }
      }))
    };
    const logger = { write: vi.fn(async () => undefined) };

    const artifact = await collectDataSourceViewsArtifact({
      dataSourceId: "data-source-1",
      notion,
      logger
    });

    expect(artifact).toMatchObject({
      dataSourceId: "data-source-1",
      status: "succeeded",
      warnings: []
    });
    expect(artifact.views).toEqual([
      expect.objectContaining({ id: "view-1", filter: { property_id: "old-property-id" } }),
      expect.objectContaining({ id: "view-2", filter: { property_id: "old-property-id" } })
    ]);
    expect(notion.listDataSourceViews).toHaveBeenNthCalledWith(1, "data-source-1", undefined);
    expect(notion.listDataSourceViews).toHaveBeenNthCalledWith(2, "data-source-1", "next-page");

    const directory = await mkdtemp(path.join(tmpdir(), "notion-view-artifact-"));
    await writeDataSourceViewsArtifact(directory, artifact);
    const persisted = JSON.parse(await readFile(path.join(directory, DATA_SOURCE_VIEWS_ARTIFACT_FILENAME), "utf8"));
    expect(persisted).toEqual(artifact);
  });

  it("keeps successful views and records warnings when one full view cannot be retrieved", async () => {
    const notion = {
      listDataSourceViews: vi.fn(async () => ({
        results: [{ id: "view-1" }, { id: "view-2" }],
        has_more: false,
        next_cursor: null
      })),
      retrieveView: vi.fn(async (viewId: string) => {
        if (viewId === "view-2") {
          throw new Error("not allowed");
        }
        return { object: "view", id: viewId };
      })
    };
    const logger = { write: vi.fn(async () => undefined) };

    const artifact = await collectDataSourceViewsArtifact({
      dataSourceId: "data-source-1",
      notion,
      logger
    });

    expect(artifact.status).toBe("partial_failed");
    expect(artifact.views).toEqual([{ object: "view", id: "view-1" }]);
    expect(artifact.warnings).toEqual([
      expect.objectContaining({
        code: "data_source_view_retrieve_failed",
        viewId: "view-2"
      })
    ]);
    expect(logger.write).toHaveBeenCalledWith(
      "warn",
      "data_source_view_failed",
      expect.objectContaining({ dataSourceId: "data-source-1", viewId: "view-2" })
    );
  });

  it("records a failed artifact when views cannot be listed", async () => {
    const notion = {
      listDataSourceViews: vi.fn(async () => {
        throw new Error("views endpoint unavailable");
      }),
      retrieveView: vi.fn()
    };
    const logger = { write: vi.fn(async () => undefined) };

    const artifact = await collectDataSourceViewsArtifact({
      dataSourceId: "data-source-1",
      notion,
      logger
    });

    expect(artifact.status).toBe("failed");
    expect(artifact.views).toEqual([]);
    expect(artifact.warnings).toEqual([
      expect.objectContaining({
        code: "data_source_views_list_failed"
      })
    ]);
    expect(notion.retrieveView).not.toHaveBeenCalled();
    expect(logger.write).toHaveBeenCalledWith(
      "warn",
      "data_source_views_failed",
      expect.objectContaining({ dataSourceId: "data-source-1" })
    );
  });

  it("propagates backup cancellation instead of converting it to a view warning", async () => {
    const canceled = new Error("canceled");
    const notion = {
      listDataSourceViews: vi.fn(),
      retrieveView: vi.fn()
    };
    const logger = { write: vi.fn(async () => undefined) };

    await expect(
      collectDataSourceViewsArtifact({
        dataSourceId: "data-source-1",
        notion,
        logger,
        ensureNotCanceled: () => {
          throw canceled;
        }
      })
    ).rejects.toThrow(canceled);

    expect(notion.listDataSourceViews).not.toHaveBeenCalled();
    expect(logger.write).not.toHaveBeenCalled();
  });
});

describe("page comment backup artifacts", () => {
  it("records a readable permission warning when comments cannot be read", async () => {
    const notion = {
      retrieveComments: vi.fn(async () => {
        throw new NotionApiError(403, "restricted_resource", "Insufficient permissions for this endpoint.");
      })
    };
    const logger = { write: vi.fn(async () => undefined) };

    const artifact = await collectPageCommentsArtifact({
      pageId: "page-1",
      notion,
      logger
    });

    expect(artifact).toEqual({
      object: "page_comments",
      status: "failed",
      pageId: "page-1",
      results: [],
      warnings: [
        {
          code: "comments_read_permission_missing",
          message: "Notion token 缺少 Read comments 权限，无法备份该页面评论；请在 Notion integration 中启用后重新备份",
          details: {
            pageId: "page-1",
            status: 403
          }
        }
      ]
    });
    expect(logger.write).toHaveBeenCalledWith(
      "warn",
      "comments_failed",
      expect.objectContaining({
        pageId: "page-1",
        code: "comments_read_permission_missing"
      })
    );
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_RESTORE_OPTIONS } from "../shared/constants.js";
import { normalizeRestoreReport, parseRestoreOptionsJson, parseRestoreSummaryJson } from "./restoreReport.js";

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
      warnings: [],
      errors: [],
      manifestPath: "restore-manifest.json"
    });

    expect(report?.options).toEqual(DEFAULT_RESTORE_OPTIONS);
    expect(report?.summary).toMatchObject({
      createdPages: 1,
      createdDataSources: 0,
      createdBlocks: 0,
      createdViews: 0,
      skippedItems: 0,
      failedItems: 0,
      warningCount: 0
    });
    expect(report?.mappings.pages).toEqual({ "old-page": "new-page" });
    expect(report?.mappings.properties).toEqual({});
    expect(report?.mappings.views).toEqual({});
    expect(report?.mappings.comments).toEqual({});
  });

  it("parses stored restore options and summary JSON defensively", () => {
    expect(parseRestoreOptionsJson(null)).toEqual(DEFAULT_RESTORE_OPTIONS);
    expect(parseRestoreOptionsJson('{"restoreComments":false,"restoreViews":false,"importExternalUrls":false,"relationStrategy":"mapped_only"}')).toEqual(DEFAULT_RESTORE_OPTIONS);
    expect(parseRestoreSummaryJson('{"createdPages":2,"createdViews":3}')).toMatchObject({
      createdPages: 2,
      createdViews: 3,
      createdDataSources: 0,
      warningCount: 0
    });
  });
});

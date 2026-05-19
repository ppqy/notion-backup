import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotionObject } from "../notionClient.js";

type RepositoryModule = typeof import("./notionRepository.js");
type LoadedRepository = RepositoryModule & { closeDb: () => void };

let loaded: LoadedRepository | null = null;
let tempDir: string | null = null;

afterEach(() => {
  loaded?.closeDb();
  loaded = null;
  vi.unstubAllEnvs();
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("notion repository discovery cache", () => {
  it("removes search-discovered rows that are absent from the latest search refresh", async () => {
    const repository = await loadRepository();

    repository.upsertDiscoveredContent([page("old-page", "Deleted"), page("kept-page", "Original")], "search");
    repository.upsertDiscoveredContent([page("manual-page", "Manual")], "manual");

    repository.syncSearchDiscoveredContent([page("kept-page", "Updated"), page("new-page", "New")]);

    const result = repository.listDiscoveredContent({ limit: 10, offset: 0 });
    const items = result.items;
    expect(items.map((item) => item.objectId).sort()).toEqual(["kept-page", "manual-page", "new-page"]);
    expect(result.total).toBe(3);
    expect(items.find((item) => item.objectId === "old-page")).toBeUndefined();
    expect(items.find((item) => item.objectId === "kept-page")?.title).toBe("Updated");
    expect(items.find((item) => item.objectId === "manual-page")?.source).toBe("manual");
  });

  it("keeps manual rows manual if they also appear in a search refresh", async () => {
    const repository = await loadRepository();

    repository.upsertDiscoveredContent([page("manual-page", "Manual")], "manual");

    repository.syncSearchDiscoveredContent([page("manual-page", "Search title")]);
    repository.syncSearchDiscoveredContent([]);

    const result = repository.listDiscoveredContent({ limit: 10, offset: 0 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      objectId: "manual-page",
      source: "manual",
      title: "Search title"
    });
  });

  it("clears all search-discovered rows when search returns no supported objects", async () => {
    const repository = await loadRepository();

    repository.upsertDiscoveredContent([page("search-page", "Search")], "search");
    repository.upsertDiscoveredContent([page("manual-page", "Manual")], "manual");

    repository.syncSearchDiscoveredContent([]);

    const result = repository.listDiscoveredContent({ limit: 10, offset: 0 });
    expect(result.items.map((item) => item.objectId)).toEqual(["manual-page"]);
    expect(result.total).toBe(1);
  });

  it("removes manual rows when refresh validation marks them stale", async () => {
    const repository = await loadRepository();

    repository.upsertDiscoveredContent([page("manual-page", "Manual")], "manual");

    repository.syncSearchDiscoveredContent([], ["manual-page"]);

    const result = repository.listDiscoveredContent({ limit: 10, offset: 0 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("maps Notion parent objects into typed parent metadata", async () => {
    const repository = await loadRepository();

    repository.upsertDiscoveredContent(
      [
        page("parent-page", "Parent"),
        page("child-page", "Child", { type: "page_id", page_id: "parent-page" }),
        page("entry-page", "Entry", { type: "data_source_id", data_source_id: "source-id" }),
        dataSource("source-id", "Source")
      ],
      "search"
    );

    const result = repository.listDiscoveredContent({ limit: 10, offset: 0 });

    expect(result.items.find((item) => item.objectId === "parent-page")).toMatchObject({
      parentType: "workspace",
      parentId: null
    });
    expect(result.items.find((item) => item.objectId === "child-page")).toMatchObject({
      parentType: "page",
      parentId: "parent-page"
    });
    expect(result.items.find((item) => item.objectId === "entry-page")).toMatchObject({
      parentType: "data_source",
      parentId: "source-id"
    });
  });

  it("falls back gracefully for unknown parent shapes", async () => {
    const repository = await loadRepository();

    expect(repository.parseDiscoveredParent(JSON.stringify({ type: "collection_id", database_id: "database-id" }))).toEqual({
      type: "unknown",
      id: "database-id"
    });
    expect(repository.parseDiscoveredParent("not json")).toBeNull();
  });
});

async function loadRepository(): Promise<LoadedRepository> {
  vi.resetModules();
  tempDir = mkdtempSync(path.join(tmpdir(), "notion-repository-test-"));
  vi.stubEnv("DATA_DIR", tempDir);
  vi.stubEnv("DATABASE_PATH", path.join(tempDir, "app.db"));

  const dbModule = await import("../db.js");
  dbModule.migrate();
  const repository = await import("./notionRepository.js");
  loaded = {
    ...repository,
    closeDb: dbModule.closeDb
  };
  return loaded;
}

function page(id: string, title: string, parent: Record<string, unknown> = { type: "workspace", workspace: true }): NotionObject {
  return {
    object: "page",
    id,
    properties: {
      Name: {
        type: "title",
        title: [{ plain_text: title }]
      }
    },
    parent,
    url: `https://notion.so/${id}`,
    last_edited_time: "2026-05-18T00:00:00.000Z"
  };
}

function dataSource(id: string, title: string, parent: Record<string, unknown> = { type: "workspace", workspace: true }): NotionObject {
  return {
    object: "data_source",
    id,
    name: title,
    parent,
    url: `https://notion.so/${id}`,
    last_edited_time: "2026-05-18T00:00:00.000Z"
  };
}

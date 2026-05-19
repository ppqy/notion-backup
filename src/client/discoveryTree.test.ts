import { describe, expect, it } from "vitest";
import type { DiscoveredContent, NotionObjectType, NotionParentType } from "../shared/types";
import { buildDiscoveryTree, flattenDiscoveryTree } from "./discoveryTree";

describe("discovery tree", () => {
  it("nests discovered children under their discovered parent", () => {
    const tree = buildDiscoveryTree([
      content("parent", "Parent", "page", "workspace", null),
      content("child", "Child", "page", "page", "parent")
    ]);

    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0]?.item.objectId).toBe("parent");
    expect(tree.roots[0]?.children[0]?.item.objectId).toBe("child");

    const collapsed = flattenDiscoveryTree(tree, new Set());
    expect(collapsed.map((row) => (row.kind === "item" ? row.item.objectId : row.id))).toEqual(["parent"]);

    const expanded = flattenDiscoveryTree(tree, new Set(["parent"]));
    expect(expanded.map((row) => (row.kind === "item" ? row.item.objectId : row.id))).toEqual(["parent", "child"]);
  });

  it("places items with unavailable parents in a fallback group", () => {
    const tree = buildDiscoveryTree([content("entry", "Entry", "page", "data_source", "missing-source")]);

    const rows = flattenDiscoveryTree(tree, new Set());

    expect(tree.roots).toEqual([]);
    expect(tree.unavailableParent[0]?.item.objectId).toBe("entry");
    expect(rows.map((row) => (row.kind === "item" ? row.item.objectId : row.id))).toEqual(["unavailable-parent", "entry"]);
  });

  it("can force expansion for filtered results", () => {
    const tree = buildDiscoveryTree([
      content("source", "Source", "data_source", "workspace", null),
      content("entry", "Entry", "page", "data_source", "source")
    ]);

    const rows = flattenDiscoveryTree(tree, new Set(), true);

    expect(rows.map((row) => (row.kind === "item" ? row.item.objectId : row.id))).toEqual(["source", "entry"]);
  });
});

function content(
  objectId: string,
  title: string,
  objectType: NotionObjectType,
  parentType: NotionParentType | null,
  parentId: string | null
): DiscoveredContent {
  return {
    id: objectId,
    objectId,
    objectType,
    title,
    parent: null,
    parentType,
    parentId,
    url: null,
    lastEditedTime: null,
    source: "search",
    discoveredAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z"
  };
}

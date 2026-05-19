import type { DiscoveredContent } from "../shared/types";

export type DiscoveryTreeNode = {
  item: DiscoveredContent;
  children: DiscoveryTreeNode[];
};

export type DiscoveryTree = {
  roots: DiscoveryTreeNode[];
  unavailableParent: DiscoveryTreeNode[];
};

export type DiscoveryDisplayRow =
  | {
      kind: "item";
      item: DiscoveredContent;
      depth: number;
      childCount: number;
      canExpand: boolean;
      expanded: boolean;
    }
  | {
      kind: "group";
      id: "unavailable-parent";
      title: string;
      description: string;
      count: number;
    };

export function buildDiscoveryTree(items: DiscoveredContent[]): DiscoveryTree {
  const nodes = new Map<string, DiscoveryTreeNode>();
  const attachedIds = new Set<string>();

  for (const item of items) {
    nodes.set(item.objectId, { item, children: [] });
  }

  for (const node of nodes.values()) {
    const parentId = node.item.parentId;
    if (!parentId || parentId === node.item.objectId) {
      continue;
    }
    const parent = nodes.get(parentId);
    if (parent) {
      parent.children.push(node);
      attachedIds.add(node.item.objectId);
    }
  }

  const roots: DiscoveryTreeNode[] = [];
  const unavailableParent: DiscoveryTreeNode[] = [];
  for (const node of nodes.values()) {
    if (attachedIds.has(node.item.objectId)) {
      continue;
    }
    if (hasUnavailableParent(node.item)) {
      unavailableParent.push(node);
    } else {
      roots.push(node);
    }
  }

  return { roots, unavailableParent };
}

export function flattenDiscoveryTree(tree: DiscoveryTree, expandedIds: Set<string>, forceExpanded = false): DiscoveryDisplayRow[] {
  const rows: DiscoveryDisplayRow[] = [];

  for (const root of tree.roots) {
    appendNodeRows(rows, root, 0, expandedIds, forceExpanded);
  }

  if (tree.unavailableParent.length > 0) {
    rows.push({
      kind: "group",
      id: "unavailable-parent",
      title: "父级未显示的内容",
      description: "父页面或数据源未在当前结果中，仍可单独选择备份。",
      count: countNodes(tree.unavailableParent)
    });
    for (const node of tree.unavailableParent) {
      appendNodeRows(rows, node, 0, expandedIds, forceExpanded);
    }
  }

  return rows;
}

function appendNodeRows(
  rows: DiscoveryDisplayRow[],
  node: DiscoveryTreeNode,
  depth: number,
  expandedIds: Set<string>,
  forceExpanded: boolean
): void {
  const canExpand = node.children.length > 0;
  const expanded = forceExpanded || expandedIds.has(node.item.objectId);
  rows.push({
    kind: "item",
    item: node.item,
    depth,
    childCount: node.children.length,
    canExpand,
    expanded
  });

  if (!canExpand || !expanded) {
    return;
  }
  for (const child of node.children) {
    appendNodeRows(rows, child, depth + 1, expandedIds, forceExpanded);
  }
}

function hasUnavailableParent(item: DiscoveredContent): boolean {
  return Boolean(item.parentId && item.parentType !== "workspace");
}

function countNodes(nodes: DiscoveryTreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

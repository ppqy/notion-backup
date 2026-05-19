import { nanoid } from "nanoid";
import { db } from "../db.js";
import { decryptText, encryptText, maskToken } from "../crypto.js";
import { nowIso } from "../time.js";
import { parseJson, stringifyJson } from "../json.js";
import type { DiscoveredContent, NotionConnectionStatus, NotionObjectType, NotionParentType } from "../../shared/types.js";
import type { NotionObject } from "../notionClient.js";

type ConnectionRow = {
  encrypted_token: string;
  token_mask: string;
  identity_json: string | null;
  validated_at: string;
};

type ContentRow = {
  id: string;
  object_id: string;
  object_type: NotionObjectType;
  title: string;
  parent_json: string | null;
  url: string | null;
  last_edited_time: string | null;
  raw_json: string;
  source: "search" | "manual";
  discovered_at: string;
  updated_at: string;
};

const upsertDiscoveredContentSql = `
  INSERT INTO discovered_content (
     id, object_id, object_type, title, parent_json, url, last_edited_time, raw_json, source, discovered_at, updated_at
   ) VALUES (
     @id, @object_id, @object_type, @title, @parent_json, @url, @last_edited_time, @raw_json, @source, @discovered_at, @updated_at
   )
   ON CONFLICT(object_id) DO UPDATE SET
     object_type = excluded.object_type,
     title = excluded.title,
     parent_json = excluded.parent_json,
     url = excluded.url,
     last_edited_time = excluded.last_edited_time,
     raw_json = excluded.raw_json,
     source = CASE
       WHEN discovered_content.source = 'manual' THEN discovered_content.source
       ELSE excluded.source
     END,
     updated_at = excluded.updated_at
`;

export function getConnectionStatus(): NotionConnectionStatus {
  const row = db.prepare("SELECT * FROM notion_connection WHERE id = 1").get() as ConnectionRow | undefined;
  if (!row) {
    return { configured: false, identity: null, validatedAt: null };
  }
  return {
    configured: true,
    identity: parseJson<Record<string, unknown> | null>(row.identity_json, null),
    validatedAt: row.validated_at
  };
}

export function getNotionToken(): string | null {
  const row = db.prepare("SELECT encrypted_token FROM notion_connection WHERE id = 1").get() as Pick<ConnectionRow, "encrypted_token"> | undefined;
  return row ? decryptText(row.encrypted_token) : null;
}

export function saveConnection(token: string, identity: Record<string, unknown>): void {
  const timestamp = nowIso();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO notion_connection (id, encrypted_token, token_mask, identity_json, validated_at, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        encrypted_token = excluded.encrypted_token,
        token_mask = excluded.token_mask,
        identity_json = excluded.identity_json,
        validated_at = excluded.validated_at,
        updated_at = excluded.updated_at`
    ).run(encryptText(token), maskToken(token), stringifyJson(identity), timestamp, timestamp, timestamp);
    clearDiscoveredContent();
  })();
}

export function clearConnection(): void {
  db.transaction(() => {
    db.prepare("DELETE FROM notion_connection WHERE id = 1").run();
    clearDiscoveredContent();
  })();
}

export function clearDiscoveredContent(): void {
  db.prepare("DELETE FROM discovered_content").run();
}

export function upsertDiscoveredContent(objects: NotionObject[], source: "search" | "manual"): DiscoveredContent[] {
  const timestamp = nowIso();
  const rows = objects.map((object) => notionObjectToContentRow(object, source, timestamp));
  db.transaction(() => {
    upsertDiscoveredRows(rows);
  })();
  return rows.map(mapContentRow);
}

export function syncSearchDiscoveredContent(objects: NotionObject[], staleObjectIds: string[] = []): DiscoveredContent[] {
  const timestamp = nowIso();
  const rows = objects.map((object) => notionObjectToContentRow(object, "search", timestamp));

  db.transaction(() => {
    deleteDiscoveredRowsByObjectId(staleObjectIds);
    db.prepare("CREATE TEMP TABLE IF NOT EXISTS latest_search_discovered_content (object_id TEXT PRIMARY KEY)").run();
    db.prepare("DELETE FROM latest_search_discovered_content").run();
    const insertLatestSearchId = db.prepare("INSERT OR IGNORE INTO latest_search_discovered_content (object_id) VALUES (?)");
    for (const row of rows) {
      insertLatestSearchId.run(row.object_id);
    }
    db.prepare(
      `DELETE FROM discovered_content
       WHERE source = 'search'
         AND object_id NOT IN (SELECT object_id FROM latest_search_discovered_content)`
    ).run();
    upsertDiscoveredRows(rows);
    db.prepare("DELETE FROM latest_search_discovered_content").run();
  })();
  return rows.map(mapContentRow);
}

export function listAllDiscoveredContent(): DiscoveredContent[] {
  const rows = db
    .prepare(
      `SELECT * FROM discovered_content
       ORDER BY updated_at DESC, title ASC`
    )
    .all() as ContentRow[];
  return rows.map(mapContentRow);
}

export function listDiscoveredContent(options: {
  q?: string;
  type?: NotionObjectType;
  limit?: number;
  offset?: number;
}): { items: DiscoveredContent[]; total: number; lastRefreshedAt: string | null } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (options.q) {
    clauses.push("title LIKE @q");
    params.q = `%${options.q}%`;
  }
  if (options.type) {
    clauses.push("object_type = @type");
    params.type = options.type;
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM discovered_content ${where}`).get(params) as { count: number }).count;
  const rows = db
    .prepare(
      `SELECT * FROM discovered_content ${where}
       ORDER BY updated_at DESC, title ASC
       LIMIT @limit OFFSET @offset`
    )
    .all({
      ...params,
      limit: options.limit ?? 100,
      offset: options.offset ?? 0
    }) as ContentRow[];
  const latest = db.prepare("SELECT MAX(updated_at) AS updated_at FROM discovered_content").get() as { updated_at: string | null };
  return {
    items: rows.map(mapContentRow),
    total,
    lastRefreshedAt: latest.updated_at
  };
}

export function getDiscoveredByObjectId(objectId: string): DiscoveredContent | null {
  const row = db.prepare("SELECT * FROM discovered_content WHERE object_id = ?").get(objectId) as ContentRow | undefined;
  return row ? mapContentRow(row) : null;
}

function notionObjectToContentRow(object: NotionObject, source: "search" | "manual", timestamp: string): ContentRow {
  const objectId = String(object.id ?? "");
  const objectType = object.object === "page" ? "page" : "data_source";
  const parent = object.parent ? stringifyJson(object.parent) : null;
  return {
    id: nanoid(),
    object_id: objectId,
    object_type: objectType,
    title: extractTitle(object),
    parent_json: parent,
    url: typeof object.url === "string" ? object.url : null,
    last_edited_time: typeof object.last_edited_time === "string" ? object.last_edited_time : null,
    raw_json: stringifyJson(object),
    source,
    discovered_at: timestamp,
    updated_at: timestamp
  };
}

function upsertDiscoveredRows(rows: ContentRow[]): void {
  const upsert = db.prepare(upsertDiscoveredContentSql);
  for (const row of rows) {
    upsert.run(row);
  }
}

function deleteDiscoveredRowsByObjectId(objectIds: string[]): void {
  const deleteRow = db.prepare("DELETE FROM discovered_content WHERE object_id = ?");
  for (const objectId of objectIds) {
    deleteRow.run(objectId);
  }
}

export function extractTitle(object: NotionObject): string {
  if (Array.isArray(object.title)) {
    const title = plainText(object.title);
    if (title) {
      return title;
    }
  }
  const properties = object.properties as Record<string, unknown> | undefined;
  if (properties) {
    for (const property of Object.values(properties)) {
      const typed = property as { type?: string; title?: unknown[] };
      if (typed.type === "title" && Array.isArray(typed.title)) {
        const title = plainText(typed.title);
        if (title) {
          return title;
        }
      }
    }
  }
  if (typeof object.name === "string") {
    return object.name;
  }
  return "未命名";
}

function plainText(parts: unknown[]): string {
  return parts
    .map((part) => {
      const value = part as { plain_text?: string };
      return value.plain_text ?? "";
    })
    .join("")
    .trim();
}

function mapContentRow(row: ContentRow): DiscoveredContent {
  const parent = parseDiscoveredParent(row.parent_json);
  return {
    id: row.id,
    objectId: row.object_id,
    objectType: row.object_type,
    title: row.title,
    parent: row.parent_json,
    parentType: parent?.type ?? null,
    parentId: parent?.id ?? null,
    url: row.url,
    lastEditedTime: row.last_edited_time,
    source: row.source,
    discoveredAt: row.discovered_at,
    updatedAt: row.updated_at
  };
}

export function parseDiscoveredParent(parentJson: string | null): { type: NotionParentType; id: string | null } | null {
  const parent = parseJson<Record<string, unknown> | null>(parentJson, null);
  if (!parent) {
    return null;
  }

  const rawType = typeof parent.type === "string" ? parent.type : null;
  if (rawType === "workspace") {
    return { type: "workspace", id: null };
  }

  const knownParentTypes: Record<string, NotionParentType> = {
    page_id: "page",
    data_source_id: "data_source",
    database_id: "database",
    block_id: "block"
  };
  if (rawType && rawType in knownParentTypes) {
    const id = parent[rawType];
    return {
      type: knownParentTypes[rawType],
      id: typeof id === "string" ? id : null
    };
  }

  const fallbackId = ["page_id", "data_source_id", "database_id", "block_id"]
    .map((key) => parent[key])
    .find((value): value is string => typeof value === "string");
  return { type: "unknown", id: fallbackId ?? null };
}

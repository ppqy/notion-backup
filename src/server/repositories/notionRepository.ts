import { nanoid } from "nanoid";
import { db } from "../db.js";
import { decryptText, encryptText, maskToken } from "../crypto.js";
import { nowIso } from "../time.js";
import { parseJson, stringifyJson } from "../json.js";
import type { DiscoveredContent, NotionConnectionStatus, NotionObjectType } from "../../shared/types.js";
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
  const upsert = db.prepare(
    `INSERT INTO discovered_content (
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
       source = excluded.source,
       updated_at = excluded.updated_at`
  );
  const rows = objects.map((object) => notionObjectToContentRow(object, source, timestamp));
  db.transaction(() => {
    for (const row of rows) {
      upsert.run(row);
    }
  })();
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
  return {
    id: row.id,
    objectId: row.object_id,
    objectType: row.object_type,
    title: row.title,
    parent: row.parent_json,
    url: row.url,
    lastEditedTime: row.last_edited_time,
    source: row.source,
    discoveredAt: row.discovered_at,
    updatedAt: row.updated_at
  };
}

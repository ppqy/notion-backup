import { Client, type CreateFileUploadResponse, type SendFileUploadResponse } from "@notionhq/client";
import { badRequest, unauthorized } from "./errors.js";

export const NOTION_VERSION = "2026-03-11";

export type NotionObject = Record<string, unknown>;

export class NotionApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type RequestOptions = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class NotionClient {
  private readonly client: Client;
  private lastRequestAt = 0;

  constructor(private readonly token: string, private readonly onLog?: (event: Record<string, unknown>) => void) {
    this.client = new Client({
      auth: token,
      notionVersion: NOTION_VERSION
    });
  }

  async request<T = NotionObject>(options: RequestOptions): Promise<T> {
    return this.executeWithRetry(options.path, async () => {
      const request = this.client.request.bind(this.client) as <R>(args: {
        path: string;
        method: string;
        query?: Record<string, string | number | boolean>;
        body?: unknown;
      }) => Promise<R>;
      return request<T>({
        path: options.path,
        method: options.method.toLowerCase(),
        query: options.query,
        body: options.body
      });
    });
  }

  async createSinglePartFileUpload(input: { filename: string; contentType?: string }): Promise<CreateFileUploadResponse> {
    return this.executeWithRetry("file_uploads", () =>
      this.client.fileUploads.create({
        mode: "single_part",
        filename: input.filename,
        ...(input.contentType ? { content_type: input.contentType } : {})
      })
    );
  }

  async sendFileUpload(input: { fileUploadId: string; filename: string; data: Blob }): Promise<SendFileUploadResponse> {
    return this.executeWithRetry(`file_uploads/${input.fileUploadId}/send`, () =>
      this.client.fileUploads.send({
        file_upload_id: input.fileUploadId,
        file: {
          filename: input.filename,
          data: input.data
        }
      })
    );
  }

  private async executeWithRetry<T>(path: string, operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      await this.throttle();
      try {
        return await operation();
      } catch (error) {
        const normalized = normalizeNotionError(error);
        if (!shouldRetry(normalized, attempt)) {
          throw normalized;
        }
        const waitMs = retryDelayMs(normalized, attempt);
        this.onLog?.({
          level: "warn",
          event: "notion_retry",
          path,
          status: normalized.status,
          attempt: attempt + 1,
          waitMs
        });
        attempt += 1;
        await delay(waitMs);
      }
    }
  }

  async validateToken(): Promise<Record<string, unknown>> {
    try {
      const user = await this.request<NotionObject>({
        method: "GET",
        path: "users/me"
      });
      return {
        object: user.object,
        id: user.id,
        name: typeof user.name === "string" ? user.name : null,
        type: user.type,
        workspace_name: typeof user.workspace_name === "string" ? user.workspace_name : null
      };
    } catch (error) {
      if (error instanceof NotionApiError && [401, 403].includes(error.status)) {
        throw unauthorized("Notion token 无效或权限不足");
      }
      throw error;
    }
  }

  async searchAll(): Promise<NotionObject[]> {
    const results: NotionObject[] = [];
    let startCursor: string | undefined;
    do {
      const response = await this.request<{ results: NotionObject[]; has_more: boolean; next_cursor: string | null }>({
        method: "POST",
        path: "search",
        body: {
          page_size: 100,
          start_cursor: startCursor
        }
      });
      results.push(...response.results);
      startCursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (startCursor);
    return results;
  }

  async retrievePage(id: string): Promise<NotionObject> {
    return this.request({ method: "GET", path: `pages/${id}` });
  }

  async retrieveDataSource(id: string): Promise<NotionObject> {
    return this.request({ method: "GET", path: `data_sources/${id}` });
  }

  async queryDataSource(id: string, startCursor?: string): Promise<{ results: NotionObject[]; has_more: boolean; next_cursor: string | null }> {
    return this.request({
      method: "POST",
      path: `data_sources/${id}/query`,
      body: {
        page_size: 100,
        start_cursor: startCursor
      }
    });
  }

  async listDataSourceViews(id: string, startCursor?: string): Promise<{ results: NotionObject[]; has_more: boolean; next_cursor: string | null }> {
    return this.request({
      method: "GET",
      path: "views",
      query: {
        data_source_id: id,
        page_size: 100,
        ...(startCursor ? { start_cursor: startCursor } : {})
      }
    });
  }

  async retrieveView(id: string): Promise<NotionObject> {
    return this.request({
      method: "GET",
      path: `views/${id}`
    });
  }

  async listBlockChildren(id: string, startCursor?: string): Promise<{ results: NotionObject[]; has_more: boolean; next_cursor: string | null }> {
    return this.request({
      method: "GET",
      path: `blocks/${id}/children`,
      query: {
        page_size: 100,
        ...(startCursor ? { start_cursor: startCursor } : {})
      }
    });
  }

  async retrievePageProperty(pageId: string, propertyId: string, startCursor?: string): Promise<NotionObject> {
    return this.request({
      method: "GET",
      path: `pages/${pageId}/properties/${propertyId}`,
      query: startCursor ? { start_cursor: startCursor } : undefined
    });
  }

  async retrieveComments(blockId: string): Promise<NotionObject> {
    return this.request({
      method: "GET",
      path: "comments",
      query: {
        block_id: blockId
      }
    });
  }

  async retrieveMarkdown(pageId: string): Promise<NotionObject> {
    return this.request({
      method: "GET",
      path: `pages/${pageId}/markdown`
    });
  }

  async createPage(body: unknown): Promise<NotionObject> {
    return this.request({
      method: "POST",
      path: "pages",
      body
    });
  }

  async createDatabase(body: unknown): Promise<NotionObject> {
    return this.request({
      method: "POST",
      path: "databases",
      body
    });
  }

  async appendBlockChildren(blockId: string, children: NotionObject[]): Promise<{ results: NotionObject[]; has_more: boolean; next_cursor: string | null }> {
    return this.request({
      method: "PATCH",
      path: `blocks/${blockId}/children`,
      body: {
        children
      }
    });
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const waitMs = Math.max(0, 350 - elapsed);
    if (waitMs > 0) {
      await delay(waitMs);
    }
    this.lastRequestAt = Date.now();
  }
}

function normalizeNotionError(error: unknown): NotionApiError {
  const candidate = error as { status?: number; code?: string; message?: string; body?: unknown; headers?: Record<string, string> };
  return new NotionApiError(
    typeof candidate.status === "number" ? candidate.status : 500,
    candidate.code || "notion_error",
    candidate.message || "Notion API 请求失败",
    {
      body: candidate.body,
      headers: candidate.headers
    }
  );
}

function shouldRetry(error: NotionApiError, attempt: number): boolean {
  if (attempt >= 3) {
    return false;
  }
  if ([401, 403, 404].includes(error.status)) {
    return false;
  }
  return error.status === 429 || error.status >= 500;
}

function retryDelayMs(error: NotionApiError, attempt: number): number {
  const retryAfter = (error.details as { headers?: Record<string, string> } | undefined)?.headers?.["retry-after"];
  if (error.status === 429 && retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds)) {
      return seconds * 1000;
    }
  }
  return Math.min(8000, 500 * 2 ** attempt);
}

export function ensureSupportedObjectType(object: NotionObject): "page" | "data_source" {
  if (object.object === "page") {
    return "page";
  }
  if (object.object === "data_source" || object.object === "database") {
    return "data_source";
  }
  throw badRequest("仅支持添加页面或数据源");
}

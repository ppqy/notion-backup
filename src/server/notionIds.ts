import { badRequest } from "./errors.js";

const HEX_32 = /[0-9a-fA-F]{32}/;
const UUIDISH = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

export function normalizeNotionId(input: string): string {
  const trimmed = input.trim();
  const uuid = trimmed.match(UUIDISH)?.[0];
  if (uuid) {
    return uuid.toLowerCase();
  }
  const compact = trimmed.replaceAll("-", "").match(HEX_32)?.[0];
  if (!compact) {
    throw badRequest("无法识别 Notion URL 或 ID");
  }
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`.toLowerCase();
}

export function compactNotionId(id: string): string {
  return normalizeNotionId(id).replaceAll("-", "");
}

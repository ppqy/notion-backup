import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { db } from "./db.js";
import { nowIso } from "./time.js";

const SECRET_FILE = path.join(config.dataDir, "app-secret.json");
const KEY_LENGTH = 32;

export type KeyMaterial = {
  key: Buffer;
  source: "env" | "generated";
  displayValue?: string;
  acknowledged: boolean;
};

function normalizeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  if (/^[A-Za-z0-9+/=]{43,}$/.test(trimmed)) {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length >= KEY_LENGTH) {
      return decoded.subarray(0, KEY_LENGTH);
    }
  }
  return createHash("sha256").update(trimmed).digest();
}

function readGeneratedSecret(): { value: string; acknowledged: boolean } | null {
  if (!existsSync(SECRET_FILE)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(SECRET_FILE, "utf8")) as { value: string; acknowledged?: boolean };
  return {
    value: parsed.value,
    acknowledged: parsed.acknowledged === true
  };
}

function writeGeneratedSecret(value: string, acknowledged: boolean): void {
  writeFileSync(SECRET_FILE, JSON.stringify({ value, acknowledged, updatedAt: nowIso() }, null, 2), {
    mode: 0o600
  });
}

export function getKeyMaterial(): KeyMaterial {
  if (config.appEncryptionKey) {
    return {
      key: normalizeKey(config.appEncryptionKey),
      source: "env",
      acknowledged: true
    };
  }

  const existing = readGeneratedSecret();
  if (existing) {
    return {
      key: normalizeKey(existing.value),
      source: "generated",
      displayValue: existing.acknowledged ? undefined : existing.value,
      acknowledged: existing.acknowledged
    };
  }

  const value = randomBytes(KEY_LENGTH).toString("base64url");
  writeGeneratedSecret(value, false);
  return {
    key: normalizeKey(value),
    source: "generated",
    displayValue: value,
    acknowledged: false
  };
}

export function acknowledgeGeneratedKey(): void {
  if (config.appEncryptionKey) {
    return;
  }
  const existing = readGeneratedSecret();
  if (existing) {
    writeGeneratedSecret(existing.value, true);
  }
}

export function encryptText(plainText: string): string {
  const key = getKeyMaterial().key;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptText(payload: string): string {
  const [version, ivText, tagText, encryptedText] = payload.split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("Unsupported encrypted payload");
  }
  const key = getKeyMaterial().key;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const derived = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [scheme, salt, expected] = storedHash.split(":");
  if (scheme !== "scrypt" || !salt || !expected) {
    return false;
  }
  const derived = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "base64url");
  return expectedBuffer.length === derived.length && timingSafeEqual(expectedBuffer, derived);
}

export function createSessionToken(): { token: string; hash: string } {
  const token = nanoid(48);
  return {
    token,
    hash: createHash("sha256").update(token).digest("base64url")
  };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function maskToken(token: string): string {
  if (token.length <= 12) {
    return "****";
  }
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export function setMeta(key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, nowIso());
}

export function getMeta(key: string): string | null {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

import type { FastifyRequest } from "fastify";
import { nanoid } from "nanoid";
import { db } from "./db.js";
import { badRequest, conflict, unauthorized } from "./errors.js";
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from "./crypto.js";
import { nowIso } from "./time.js";
import { config } from "./config.js";
import type { SessionUser } from "../shared/types.js";

const SESSION_DAYS = 14;

type AdminRow = {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
};

export function hasAdmin(): boolean {
  const count = db.prepare("SELECT COUNT(*) AS count FROM admins").get() as { count: number };
  return count.count > 0;
}

export function createAdmin(username: string, password: string): SessionUser {
  const normalized = username.trim();
  if (normalized.length < 3) {
    throw badRequest("用户名至少需要 3 个字符");
  }
  if (password.length < 8) {
    throw badRequest("密码至少需要 8 个字符");
  }
  if (hasAdmin()) {
    throw conflict("管理员账号已经存在");
  }

  const admin = {
    id: nanoid(),
    username: normalized,
    password_hash: hashPassword(password),
    created_at: nowIso(),
    updated_at: nowIso()
  };
  db.prepare(
    `INSERT INTO admins (id, username, password_hash, created_at, updated_at)
     VALUES (@id, @username, @password_hash, @created_at, @updated_at)`
  ).run(admin);
  return { id: admin.id, username: admin.username };
}

export function login(username: string, password: string): { user: SessionUser; token: string; expiresAt: string } {
  const row = db.prepare("SELECT * FROM admins WHERE username = ?").get(username.trim()) as AdminRow | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw unauthorized("用户名或密码错误");
  }
  const { token, hash } = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, admin_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(nanoid(), row.id, hash, expiresAt, nowIso());
  return {
    user: { id: row.id, username: row.username },
    token,
    expiresAt
  };
}

export function logout(token: string | undefined): void {
  if (!token) {
    return;
  }
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
}

export function getUserBySessionToken(token: string | undefined): SessionUser | null {
  if (!token) {
    return null;
  }
  const row = db
    .prepare(
      `SELECT admins.id, admins.username, sessions.expires_at
       FROM sessions
       JOIN admins ON admins.id = sessions.admin_id
       WHERE sessions.token_hash = ?`
    )
    .get(hashSessionToken(token)) as { id: string; username: string; expires_at: string } | undefined;
  if (!row) {
    return null;
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
    return null;
  }
  return { id: row.id, username: row.username };
}

export function requireUser(request: FastifyRequest): SessionUser {
  const token = request.cookies[config.sessionCookieName];
  const user = getUserBySessionToken(token);
  if (!user) {
    throw unauthorized();
  }
  return user;
}

export function changePassword(userId: string, currentPassword: string, nextPassword: string): void {
  if (nextPassword.length < 8) {
    throw badRequest("新密码至少需要 8 个字符");
  }
  const row = db.prepare("SELECT * FROM admins WHERE id = ?").get(userId) as AdminRow | undefined;
  if (!row || !verifyPassword(currentPassword, row.password_hash)) {
    throw unauthorized("当前密码错误");
  }
  db.prepare("UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(nextPassword), nowIso(), userId);
  db.prepare("DELETE FROM sessions WHERE admin_id = ?").run(userId);
}

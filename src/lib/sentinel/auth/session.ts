/**
 * Session management: opaque random tokens delivered in an httpOnly cookie.
 *
 * Only the sha256 of the token is persisted (sessions table), so a database
 * read alone never yields a usable session. Sessions expire after 30 days
 * and are pruned lazily on access.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  deleteSession,
  getSession,
  getUserById,
  insertSession,
  nowIso,
  pruneAuth,
} from "@/db/store";
import type { SafeUser } from "@/lib/sentinel/types";

export const SESSION_COOKIE = "sentinel_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function toSafeUser(u: {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  passwordHash?: string;
  githubId?: string;
  createdAt: string;
}): SafeUser {
  const providers: SafeUser["providers"] = [];
  if (u.passwordHash) providers.push("password");
  if (u.githubId) providers.push("github");
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    providers,
    createdAt: u.createdAt,
  };
}

/** Create a session for a user. Returns the raw token (set it as the cookie). */
export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  insertSession({ id: hashToken(token), userId, createdAt: now.toISOString(), expiresAt });
  return { token, expiresAt };
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get("cookie") ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name && !(name in out)) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function sessionTokenFrom(req: Request): string | null {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || token.length < 16 || token.length > 128) return null;
  return token;
}

/** Resolve the request's session cookie to a user (null when absent/invalid/expired). */
export function getSessionUser(req: Request): SafeUser | null {
  const token = sessionTokenFrom(req);
  if (!token) return null;
  const now = nowIso();
  const session = getSession(hashToken(token));
  if (!session) return null;
  if (session.expiresAt <= now) {
    deleteSession(session.id);
    return null;
  }
  const user = getUserById(session.userId);
  if (!user) {
    deleteSession(session.id);
    return null;
  }
  // Opportunistic prune (cheap: runs on one read path only).
  if (Math.random() < 0.02) pruneAuth(now);
  return toSafeUser(user);
}

/** Revoke the request's session (logout). Always clears client-side state. */
export function revokeSession(req: Request): void {
  const token = sessionTokenFrom(req);
  if (token) deleteSession(hashToken(token));
}

function secureCookies(req: Request): boolean {
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

export function buildSessionCookie(req: Request, token: string, expiresAt: string): string {
  const maxAge = Math.max(
    1,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
  );
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secureCookies(req)) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

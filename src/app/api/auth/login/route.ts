/** Email+password login. Starts a session on success. */
import { getUserByEmail } from "@/db/store";
import {
  buildSessionCookie,
  checkRateLimit,
  clientIp,
  createSession,
  normalizeEmail,
  toSafeUser,
  verifyPassword,
} from "@/lib/sentinel/auth";
import { fail, ok, readJson } from "../../_util";

export const dynamic = "force-dynamic";

/**
 * A real scrypt hash of a dummy password. Verified (and discarded) when the
 * account is missing or has no password, so failures take the same time and
 * don't reveal whether an email is registered.
 */
const DUMMY_HASH =
  "scrypt$16384$8$1$99ddd7e0dbf3c89f8423c3a0c4e13161$69a66befea30665a63bdc176e3dfce757ccda3775cd93c1918c136477713ac6e";

export async function POST(req: Request) {
  const rl = checkRateLimit(`login:${clientIp(req)}`, 10, 10 * 60 * 1000);
  if (!rl.allowed) {
    return fail("Too many login attempts. Try again shortly.", 429, {
      retryAfterSec: rl.retryAfterSec,
    });
  }
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Bad request.", 400);
  }
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const user = email ? getUserByEmail(email) : undefined;
  const valid =
    !!email &&
    password.length > 0 &&
    (await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)) &&
    !!user?.passwordHash;
  if (!email || !user || !valid) {
    return fail("Invalid email or password.", 401);
  }
  const { token, expiresAt } = createSession(user.id);
  const res = ok({ user: toSafeUser(user) });
  res.headers.set("Set-Cookie", buildSessionCookie(req, token, expiresAt));
  return res;
}

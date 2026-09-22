/** Email+password sign-up. Creates the user and starts a session. */
import { getUserByEmail, insertUser, nowIso, uid } from "@/db/store";
import {
  buildSessionCookie,
  checkRateLimit,
  clientIp,
  createSession,
  hashPassword,
  normalizeEmail,
  normalizeName,
  passwordPolicyError,
  toSafeUser,
} from "@/lib/sentinel/auth";
import { fail, ok, readJson } from "../../_util";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rl = checkRateLimit(`signup:${clientIp(req)}`, 10, 10 * 60 * 1000);
  if (!rl.allowed) {
    return fail("Too many sign-up attempts. Try again shortly.", 429, {
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
  if (!email) return fail("Enter a valid email address.", 400);
  const policy = passwordPolicyError(typeof body.password === "string" ? body.password : "");
  if (policy) return fail(policy, 400);
  if (getUserByEmail(email)) {
    return fail("An account with this email already exists. Log in instead.", 409);
  }
  const user = insertUser({
    id: uid("usr"),
    email,
    name: normalizeName(body.name, email),
    passwordHash: await hashPassword(body.password as string),
    createdAt: nowIso(),
  });
  const { token, expiresAt } = createSession(user.id);
  const res = ok({ user: toSafeUser(user) }, { status: 201 });
  res.headers.set("Set-Cookie", buildSessionCookie(req, token, expiresAt));
  return res;
}

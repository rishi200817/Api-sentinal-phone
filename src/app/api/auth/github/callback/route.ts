/**
 * GitHub OAuth callback: validate state, exchange the code, link or create
 * the account, start a session, and redirect back into the app.
 */
import { NextResponse } from "next/server";
import {
  consumeOAuthState,
  getUserByEmail,
  getUserByGithubId,
  insertUser,
  linkGithub,
  nowIso,
  uid,
} from "@/db/store";
import {
  buildSessionCookie,
  createSession,
  githubProvider,
  safeNext,
} from "@/lib/sentinel/auth";

export const dynamic = "force-dynamic";

function loginWith(req: Request, error: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${error}`, req.url));
}

function finish(req: Request, userId: string, next: string): NextResponse {
  const { token, expiresAt } = createSession(userId);
  const res = NextResponse.redirect(new URL(safeNext(next), req.url));
  res.headers.set("Set-Cookie", buildSessionCookie(req, token, expiresAt));
  return res;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("error")) return loginWith(req, "github-denied");
  const code = searchParams.get("code") ?? "";
  const state = searchParams.get("state") ?? "";
  const saved = state ? consumeOAuthState(state, nowIso()) : null;
  if (!code || !saved) return loginWith(req, "invalid-state");

  let account;
  try {
    const redirectUri = new URL("/api/auth/github/callback", req.url).toString();
    const { accessToken } = await githubProvider.exchangeCode(code, redirectUri);
    account = await githubProvider.fetchAccount(accessToken);
  } catch {
    return loginWith(req, "github-failed");
  }

  // Existing GitHub-linked account: log in.
  const linked = getUserByGithubId(account.providerId);
  if (linked) return finish(req, linked.id, saved.next);

  // Verified email matching a password account: link it (safe — GitHub
  // proved ownership of the address).
  if (account.email && account.emailVerified) {
    const byEmail = getUserByEmail(account.email);
    if (byEmail) {
      linkGithub(byEmail.id, account.providerId, account.avatarUrl);
      return finish(req, byEmail.id, saved.next);
    }
  }

  // Email taken by an account we cannot prove ownership of: stop, don't merge.
  if (account.email && getUserByEmail(account.email)) {
    return loginWith(req, "email-taken");
  }
  if (!account.email) return loginWith(req, "no-email");

  const user = insertUser({
    id: uid("usr"),
    email: account.email.trim().toLowerCase(),
    name: (account.name ?? account.email.split("@")[0] ?? "user").slice(0, 80),
    githubId: account.providerId,
    avatarUrl: account.avatarUrl ?? undefined,
    createdAt: nowIso(),
  });
  return finish(req, user.id, saved.next);
}

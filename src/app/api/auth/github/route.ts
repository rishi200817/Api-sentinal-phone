/** Start GitHub OAuth: mint a one-time state and redirect to GitHub. */
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { insertOAuthState, nowIso } from "@/db/store";
import { githubProvider, safeNext } from "@/lib/sentinel/auth";

export const dynamic = "force-dynamic";

function loginWith(req: Request, error: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${error}`, req.url));
}

export async function GET(req: Request) {
  if (!githubProvider.isConfigured()) return loginWith(req, "github-not-configured");
  const { searchParams } = new URL(req.url);
  const state = randomBytes(24).toString("base64url");
  insertOAuthState({
    state,
    provider: "github",
    next: safeNext(searchParams.get("next")),
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  const redirectUri = new URL("/api/auth/github/callback", req.url).toString();
  return NextResponse.redirect(githubProvider.authorizationUrl(state, redirectUri));
}

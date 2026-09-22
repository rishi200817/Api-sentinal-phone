/**
 * Auth tests: real scrypt hashing, session lifecycle, rate limiting,
 * validation, OAuth state handling, and the GitHub provider (fetch stubbed).
 */
process.env.SENTINEL_DATA_DIR = "/tmp/sentinel-test-auth";

import { afterEach, describe, expect, it } from "vitest";
import {
  consumeOAuthState,
  deleteSession,
  getSession,
  getUserByEmail,
  getUserByGithubId,
  insertOAuthState,
  insertSession,
  insertUser,
  linkGithub,
  nowIso,
  store,
  uid,
} from "@/db/store";
import {
  buildSessionCookie,
  checkRateLimit,
  createSession,
  getSessionUser,
  githubProvider,
  hashPassword,
  hashToken,
  normalizeEmail,
  normalizeName,
  passwordPolicyError,
  resetRateLimits,
  revokeSession,
  safeNext,
  sessionTokenFrom,
  toSafeUser,
  verifyPassword,
} from "@/lib/sentinel/auth";

afterEach(() => {
  store.resetForTests();
  resetRateLimits();
});

function seedUser(over: Record<string, unknown> = {}) {
  return insertUser({
    id: uid("usr"),
    email: "ada@example.com",
    name: "Ada",
    createdAt: nowIso(),
    ...over,
  } as Parameters<typeof insertUser>[0]);
}

function reqWithCookie(cookie: string | null): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request("http://localhost/api/x", { headers });
}

describe("passwords (scrypt)", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct-horse-9");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct-horse-9", hash)).toBe(true);
  });

  it("rejects wrong passwords and malformed hashes", async () => {
    const hash = await hashPassword("correct-horse-9");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
    expect(await verifyPassword("correct-horse-9", "not-a-hash")).toBe(false);
    expect(await verifyPassword("correct-horse-9", "scrypt$1$1$1$abcd$ef")).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("enforces the password policy", async () => {
    expect(passwordPolicyError("short")).toContain("at least 8");
    expect(passwordPolicyError("long-enough-1")).toBeNull();
    await expect(hashPassword("short")).rejects.toThrow();
  });

  it("uses unique salts", async () => {
    const a = await hashPassword("same-password-1");
    const b = await hashPassword("same-password-1");
    expect(a).not.toBe(b);
  });
});

describe("sessions", () => {
  it("creates a session resolvable to a safe user", () => {
    const user = seedUser({ passwordHash: "h" });
    const { token } = createSession(user.id);
    const me = getSessionUser(reqWithCookie(`${"sentinel_session"}=${token}`));
    expect(me?.id).toBe(user.id);
    expect(me?.email).toBe("ada@example.com");
    expect(me && "passwordHash" in me).toBe(false);
    expect(me?.providers).toEqual(["password"]);
  });

  it("returns null without a cookie or with garbage", () => {
    seedUser();
    expect(getSessionUser(reqWithCookie(null))).toBeNull();
    expect(getSessionUser(reqWithCookie("sentinel_session=zzz"))).toBeNull();
    expect(getSessionUser(reqWithCookie("other=1"))).toBeNull();
    expect(sessionTokenFrom(reqWithCookie("a=b; sentinel_session="))).toBeNull();
  });

  it("rejects expired sessions and prunes them", () => {
    const user = seedUser();
    const { token } = createSession(user.id);
    const id = hashToken(token);
    store.replace("sessions", [{ ...getSession(id)!, expiresAt: "2000-01-01T00:00:00.000Z" }]);
    expect(getSessionUser(reqWithCookie(`sentinel_session=${token}`))).toBeNull();
    expect(getSession(id)).toBeUndefined();
  });

  it("revokes sessions on logout", () => {
    const user = seedUser();
    const { token } = createSession(user.id);
    const req = reqWithCookie(`sentinel_session=${token}`);
    expect(getSessionUser(req)).not.toBeNull();
    revokeSession(req);
    expect(getSessionUser(req)).toBeNull();
  });

  it("drops sessions whose user no longer exists", () => {
    const user = seedUser();
    const { token } = createSession(user.id);
    store.replace("users", []);
    expect(getSessionUser(reqWithCookie(`sentinel_session=${token}`))).toBeNull();
    expect(getSession(hashToken(token))).toBeUndefined();
  });

  it("builds a hardened cookie", () => {
    const user = seedUser();
    const { token, expiresAt } = createSession(user.id);
    const c = buildSessionCookie(new Request("http://localhost/"), token, expiresAt);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=");
    expect(c).not.toContain("Secure"); // plain http must keep working locally
    const https = buildSessionCookie(new Request("https://app.example/"), token, expiresAt);
    expect(https).toContain("Secure");
  });

  it("never stores the raw token", () => {
    const user = seedUser();
    const { token } = createSession(user.id);
    expect(getSession(token)).toBeUndefined();
    expect(getSession(hashToken(token))?.userId).toBe(user.id);
    deleteSession("missing");
  });

  it("derives providers in toSafeUser", () => {
    expect(toSafeUser(seedUser({ passwordHash: "h", githubId: "123" })).providers).toEqual([
      "password",
      "github",
    ]);
    expect(toSafeUser(seedUser({ githubId: "123" })).providers).toEqual(["github"]);
  });
});

describe("rate limiting", () => {
  it("allows N then blocks within a window", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("k", 5, 60_000).allowed).toBe(true);
    }
    const blocked = checkRateLimit("k", 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets after the window", () => {
    const now = Date.now();
    expect(checkRateLimit("w", 1, 1000, now).allowed).toBe(true);
    expect(checkRateLimit("w", 1, 1000, now + 500).allowed).toBe(false);
    expect(checkRateLimit("w", 1, 1000, now + 1001).allowed).toBe(true);
  });
});

describe("validation", () => {
  it("normalizes and validates emails", () => {
    expect(normalizeEmail(" Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });

  it("normalizes names with a fallback", () => {
    expect(normalizeName("  Ada  Lovelace ", "x@y.z")).toBe("Ada Lovelace");
    expect(normalizeName(undefined, "ada@example.com")).toBe("ada");
  });

  it("blocks open redirects in next", () => {
    expect(safeNext("/dashboard/x")).toBe("/dashboard/x");
    expect(safeNext("https://evil.example")).toBe("/dashboard");
    expect(safeNext("//evil.example/x")).toBe("/dashboard");
    expect(safeNext(null)).toBe("/dashboard");
  });
});

describe("users", () => {
  it("looks up emails case-insensitively and links GitHub", async () => {
    const u = seedUser({ passwordHash: await hashPassword("password-1") });
    expect(getUserByEmail("ADA@EXAMPLE.COM")?.id).toBe(u.id);
    expect(getUserByGithubId("42")).toBeUndefined();
    linkGithub(u.id, "42", "https://avatar.example/a.png");
    expect(getUserByGithubId("42")?.id).toBe(u.id);
  });
});

describe("oauth state", () => {
  it("is single-use", () => {
    const now = nowIso();
    insertOAuthState({
      state: "s1",
      provider: "github",
      next: "/dashboard",
      createdAt: now,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(consumeOAuthState("s1", nowIso())?.next).toBe("/dashboard");
    expect(consumeOAuthState("s1", nowIso())).toBeNull();
  });

  it("rejects expired and unknown states", () => {
    insertOAuthState({
      state: "old",
      provider: "github",
      next: "/dashboard",
      createdAt: "2000-01-01T00:00:00.000Z",
      expiresAt: "2000-01-01T00:10:00.000Z",
    });
    expect(consumeOAuthState("old", nowIso())).toBeNull();
    expect(consumeOAuthState("nope", nowIso())).toBeNull();
  });
});

describe("github provider", () => {
  const OLD_ID = process.env.GITHUB_CLIENT_ID;
  const OLD_SECRET = process.env.GITHUB_CLIENT_SECRET;
  afterEach(() => {
    if (OLD_ID === undefined) delete process.env.GITHUB_CLIENT_ID;
    else process.env.GITHUB_CLIENT_ID = OLD_ID;
    if (OLD_SECRET === undefined) delete process.env.GITHUB_CLIENT_SECRET;
    else process.env.GITHUB_CLIENT_SECRET = OLD_SECRET;
  });

  it("reports configuration honestly", () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    expect(githubProvider.isConfigured()).toBe(false);
    process.env.GITHUB_CLIENT_ID = "id";
    expect(githubProvider.isConfigured()).toBe(false);
    process.env.GITHUB_CLIENT_SECRET = "secret";
    expect(githubProvider.isConfigured()).toBe(true);
  });

  it("builds a correct authorization URL", () => {
    process.env.GITHUB_CLIENT_ID = "cid";
    process.env.GITHUB_CLIENT_SECRET = "csecret";
    const url = new URL(githubProvider.authorizationUrl("state1", "https://app.example/cb"));
    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("state")).toBe("state1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/cb");
    expect(url.searchParams.get("scope")).toContain("user:email");
  });

  it("exchanges codes and fetches accounts", async () => {
    process.env.GITHUB_CLIENT_ID = "cid";
    process.env.GITHUB_CLIENT_SECRET = "csecret";
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("access_token")) {
        return new Response(JSON.stringify({ access_token: "tok123" }), { status: 200 });
      }
      if (u.endsWith("/user/emails")) {
        return new Response(
          JSON.stringify([{ email: "ada@users.noreply.github.com", primary: true, verified: true }]),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ id: 42, login: "ada", name: null, email: null, avatar_url: "https://a/x" }),
        { status: 200 }
      );
    }) as typeof fetch;
    try {
      const { accessToken } = await githubProvider.exchangeCode("code1", "https://app.example/cb");
      expect(accessToken).toBe("tok123");
      const acct = await githubProvider.fetchAccount(accessToken);
      expect(acct.providerId).toBe("42");
      expect(acct.email).toBe("ada@users.noreply.github.com");
      expect(acct.emailVerified).toBe(true);
      expect(calls.some((c) => c.includes("access_token"))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("surfaces token errors instead of crashing", async () => {
    process.env.GITHUB_CLIENT_ID = "cid";
    process.env.GITHUB_CLIENT_SECRET = "csecret";
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "bad_code", error_description: "Bad." }), {
        status: 200,
      })) as typeof fetch;
    try {
      await expect(githubProvider.exchangeCode("bad", "https://app.example/cb")).rejects.toThrow(
        "Bad."
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

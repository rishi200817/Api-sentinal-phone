/**
 * OAuth provider abstraction. GitHub is the first implementation; adding
 * Google/GitLab/etc. means implementing AuthProvider — no route changes.
 *
 * Honest-by-design: `isConfigured()` reports whether the provider has
 * credentials, so the UI can show "not configured" instead of a dead button.
 */
export interface OAuthAccount {
  provider: "github";
  providerId: string;
  /** Email when the provider supplies one, else null. */
  email: string | null;
  /** True only when the provider asserts the address is verified. */
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

export interface AuthProvider {
  id: string;
  label: string;
  isConfigured(): boolean;
  authorizationUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string }>;
  fetchAccount(accessToken: string): Promise<OAuthAccount>;
}

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_USER = "https://api.github.com/user";
const GITHUB_EMAILS = "https://api.github.com/user/emails";

function githubClientId(): string {
  return (process.env.GITHUB_CLIENT_ID ?? "").trim();
}

function githubClientSecret(): string {
  return (process.env.GITHUB_CLIENT_SECRET ?? "").trim();
}

export const githubProvider: AuthProvider = {
  id: "github",
  label: "GitHub",

  isConfigured() {
    return githubClientId().length > 0 && githubClientSecret().length > 0;
  },

  authorizationUrl(state: string, redirectUri: string) {
    const url = new URL(GITHUB_AUTHORIZE);
    url.searchParams.set("client_id", githubClientId());
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "read:user user:email");
    url.searchParams.set("state", state);
    url.searchParams.set("allow_signup", "true");
    return url.toString();
  },

  async exchangeCode(code: string, redirectUri: string) {
    const res = await fetch(GITHUB_TOKEN, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: githubClientId(),
        client_secret: githubClientSecret(),
        code,
        redirect_uri: redirectUri,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new Error(
        json.error_description || json.error || "GitHub did not return an access token."
      );
    }
    return { accessToken: json.access_token };
  },

  async fetchAccount(accessToken: string) {
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "api-sentinel",
    };
    const res = await fetch(GITHUB_USER, { headers });
    if (!res.ok) throw new Error(`GitHub user lookup failed (${res.status}).`);
    const me = (await res.json()) as {
      id?: number | string;
      login?: string;
      name?: string | null;
      email?: string | null;
      avatar_url?: string | null;
    };
    if (me.id === undefined || me.id === null) throw new Error("GitHub user has no id.");
    let email: string | null = typeof me.email === "string" ? me.email : null;
    let emailVerified = false;
    // Prefer the verified primary address from the emails API (covers private emails).
    const er = await fetch(GITHUB_EMAILS, { headers });
    if (er.ok) {
      const list = (await er.json().catch(() => [])) as {
        email?: string;
        primary?: boolean;
        verified?: boolean;
      }[];
      const primary = list.find((e) => e.primary && e.verified) ?? list.find((e) => e.verified);
      if (primary?.email) {
        email = primary.email;
        emailVerified = true;
      }
    }
    return {
      provider: "github" as const,
      providerId: String(me.id),
      email,
      emailVerified,
      name: me.name || me.login || null,
      avatarUrl: me.avatar_url || null,
    };
  },
};

export function providersStatus(): { credentials: boolean; github: boolean } {
  return { credentials: true, github: githubProvider.isConfigured() };
}

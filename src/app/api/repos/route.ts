import { getRepo, listRepos, nowIso, saveRepo, store, uid } from "@/db/store";
import { log } from "@/lib/sentinel/logging";
import { getRepoInfo, resolveGitHubToken } from "@/lib/sentinel/git/github";
import { parseGitHubRepoUrl, clampString } from "@/lib/sentinel/security/guards";
import { getSessionUser, loginRequiredPayload } from "@/lib/sentinel/auth";
import { fail, ok, readJson } from "../_util";

export const dynamic = "force-dynamic";

export async function GET() {
  const repos = listRepos().map((r) => ({
    ...r,
    // never leak anything secret; Repository rows hold no secrets by design
  }));
  return ok({ repos });
}

export async function POST(req: Request) {
  if (!getSessionUser(req)) return fail("Login required to connect repositories.", 401, loginRequiredPayload());
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Bad request.", 400);
  }
  const url = clampString(body.url, 500);
  const branch = clampString((body.branch as string) || "", 200);
  const parsed = parseGitHubRepoUrl(url);
  if (!parsed) {
    return fail("Only public GitHub repository URLs are supported (https://github.com/owner/repo).", 400);
  }
  const existing = listRepos().find(
    (r) => r.provider === "github" && r.owner === parsed.owner && r.repo === parsed.repo
  );
  if (existing) return ok({ repo: existing, reused: true });

  // Verify access + resolve the real default branch BEFORE persisting.
  const token = resolveGitHubToken(store.getSetting("githubToken"));
  try {
    const info = await getRepoInfo(parsed.owner, parsed.repo, { token });
    const repo = {
      id: uid("repo"),
      name: `${parsed.owner}/${parsed.repo}`,
      owner: parsed.owner,
      repo: parsed.repo,
      url: `https://github.com/${parsed.owner}/${parsed.repo}`,
      defaultBranch: branch || info.defaultBranch,
      provider: "github" as const,
      status: "connected" as const,
      lastSha: null,
      lastAnalysisId: null,
      webhookEnabled: false,
      webhookSecretSet: !!(process.env.GITHUB_WEBHOOK_SECRET || store.getSetting("webhookSecret")),
      autoSyncPolicy: "manual" as const,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    saveRepo(repo);
    log.info("repo connected", { repoId: repo.id });
    void getRepo;
    return ok({ repo });
  } catch (err) {
    return fail(
      err instanceof Error ? err.message : "GitHub repository access failed.",
      502
    );
  }
}

import { getEndpoints, latestOpenApi, listAnalyses, listRepos } from "@/db/store";
import { store } from "@/db/store";
import { buildContext } from "@/lib/sentinel/agent/orchestrator";
import { fail, ok } from "../_util";

export const dynamic = "force-dynamic";

/** Aggregated dashboard state — every number derived from backend state. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repoId = searchParams.get("repoId") || undefined;
  try {
    const repos = listRepos();
    const repo = repoId ? repos.find((r) => r.id === repoId) : repos[0];
    if (!repo) return ok({ repos, repo: null });
    const ctx = buildContext(repo.id);
    const runs = listAnalyses(repo.id).slice(0, 5);
    const openapi = latestOpenApi(repo.id);
    const approvals = store.all("approvals").filter((a) => a.repoId === repo.id && a.status === "pending");
    const webhooks = store.all("webhooks").filter((w) => w.repoId === repo.id).slice(-5).reverse();
    const notifications = store.all("notifications").filter((n) => n.repoId === repo.id || !n.repoId).slice(0, 5);
    const unread = store.all("notifications").filter((n) => !n.read).length;
    return ok({
      repos,
      repo,
      health: ctx.health ?? null,
      latestRun: runs[0] ?? null,
      recentRuns: runs,
      endpoints: getEndpoints(repo.id),
      changes: ctx.changes,
      validation: ctx.validation ?? null,
      openapiVersion: openapi?.version ?? null,
      openapiSource: openapi?.source ?? null,
      approvals,
      webhooks,
      notifications,
      unread,
      aiSummary: runs[0]?.aiSummary ?? null,
      aiProvider: runs[0]?.aiProvider ?? null,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Overview failed.", 500);
  }
}

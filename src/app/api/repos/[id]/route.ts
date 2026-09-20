import { getRepo, saveRepo, store } from "@/db/store";
import { clampString, isValidId } from "@/lib/sentinel/security/guards";
import { fail, ok, readJson } from "../../_util";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isValidId(params.id)) return fail("Invalid repository id.", 400);
  const repo = getRepo(params.id);
  if (!repo) return fail("Repository not found.", 404);
  return ok({ repo });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!isValidId(params.id)) return fail("Invalid repository id.", 400);
  const repo = getRepo(params.id);
  if (!repo) return fail("Repository not found.", 404);
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Bad request.", 400);
  }
  if (typeof body.defaultBranch === "string" && body.defaultBranch.trim()) {
    repo.defaultBranch = clampString(body.defaultBranch.trim(), 200);
  }
  if (body.autoSyncPolicy === "manual" || body.autoSyncPolicy === "auto-safe" || body.autoSyncPolicy === "auto-all") {
    repo.autoSyncPolicy = body.autoSyncPolicy;
  }
  if (typeof body.webhookEnabled === "boolean") {
    repo.webhookEnabled = body.webhookEnabled;
  }
  repo.webhookSecretSet = !!(
    process.env.GITHUB_WEBHOOK_SECRET || store.getSetting("webhookSecret")
  );
  repo.updatedAt = new Date().toISOString();
  saveRepo(repo);
  return ok({ repo });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!isValidId(params.id)) return fail("Invalid repository id.", 400);
  const repo = getRepo(params.id);
  if (!repo) return fail("Repository not found.", 404);
  if (repo.provider === "demo") {
    return fail("Demo repositories cannot be deleted (use Reset instead).", 400);
  }
  const rows = store.all("repositories").filter((r) => r.id !== params.id);
  store.replace("repositories", rows);
  // Purge repo-scoped data (same hygiene as reset).
  const doomed = new Set<string>();
  for (const a of store.all("analyses")) {
    if (a.repoId === params.id) for (const id of a.changeIds) doomed.add(id);
  }
  store.replace("analyses", store.all("analyses").filter((a) => a.repoId !== params.id));
  if (doomed.size) {
    store.replace("changes", store.all("changes").filter((c) => !doomed.has(c.id)));
    store.replace("impact", store.all("impact").filter((i) => !doomed.has(i.changeId)));
  }
  store.replace("endpoints", store.all("endpoints").filter((e) => e.repoId !== params.id));
  store.replace("openapi", store.all("openapi").filter((o) => o.repoId !== params.id));
  store.replace("snapshots", store.all("snapshots").filter((s) => s.repoId !== params.id));
  store.replace("approvals", store.all("approvals").filter((a) => a.repoId !== params.id));
  store.replace("notifications", store.all("notifications").filter((n) => n.repoId !== params.id));
  return ok({ deleted: params.id });
}

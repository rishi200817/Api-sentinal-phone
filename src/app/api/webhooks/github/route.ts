/**
 * POST /api/webhooks/github — genuine GitHub push handling:
 * signature verification -> normalization -> dedup -> incremental analysis.
 */
import {
  addHistory,
  getAnalysis,
  listRepos,
  nowIso,
  store,
  uid,
  webhookSeen,
} from "@/db/store";
import { normalizePushEvent, verifySignature } from "@/lib/sentinel/git/webhook";
import { activeRunFor, runAnalysis } from "@/lib/sentinel/pipeline";
import { log } from "@/lib/sentinel/logging";
import { fail, ok } from "../../_util";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const deliveryId = req.headers.get("x-github-delivery") || "";
  const event = req.headers.get("x-github-event") || "";
  const signature = req.headers.get("x-hub-signature-256");

  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > 4 * 1024 * 1024) {
    return fail("Webhook payload too large.", 413);
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET || store.getSetting("webhookSecret") || "";
  const check = verifySignature(raw, signature, secret);
  if (!check.valid) {
    store.insert("webhooks", {
      id: uid("wh"),
      deliveryId: deliveryId || `unsigned_${Date.now()}`,
      event: event || "unknown",
      valid: false,
      rejectReason: check.reason,
      changedFiles: [],
      duplicate: false,
      receivedAt: nowIso(),
    });
    await store.flush();
    log.warn("webhook rejected", { result: check.reason });
    return fail(`Invalid webhook: ${check.reason}`, 401);
  }

  if (!deliveryId) return fail("Missing X-GitHub-Delivery id.", 400);

  // Dedup: GitHub redelivers; process each delivery exactly once.
  const seen = webhookSeen(deliveryId);
  if (seen) {
    store.insert("webhooks", {
      id: uid("wh"),
      deliveryId: `${deliveryId}:dup:${Date.now()}`,
      event,
      valid: true,
      duplicate: true,
      analysisId: seen.analysisId,
      receivedAt: nowIso(),
      changedFiles: [],
    });
    await store.flush();
    return ok({ duplicate: true, analysisId: seen.analysisId ?? null });
  }

  if (event === "ping") {
    store.insert("webhooks", {
      id: uid("wh"),
      deliveryId,
      event,
      valid: true,
      changedFiles: [],
      duplicate: false,
      receivedAt: nowIso(),
    });
    await store.flush();
    return ok({ pong: true });
  }

  if (event !== "push") {
    store.insert("webhooks", {
      id: uid("wh"),
      deliveryId,
      event,
      valid: true,
      rejectReason: `Event '${event}' ignored (only push triggers analysis).`,
      changedFiles: [],
      duplicate: false,
      receivedAt: nowIso(),
    });
    await store.flush();
    return ok({ ignored: event });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return fail("Invalid JSON payload.", 400);
  }
  const push = normalizePushEvent(payload);
  if (!push) {
    return fail("Unrecognized push payload (or branch deletion — nothing to analyze).", 400);
  }

  const repo = listRepos().find(
    (r) => r.provider === "github" && `${r.owner}/${r.repo}`.toLowerCase() === push.repoFullName.toLowerCase()
  );
  if (!repo) {
    store.insert("webhooks", {
      id: uid("wh"),
      deliveryId,
      event,
      valid: true,
      rejectReason: `Repository '${push.repoFullName}' is not connected to Sentinel.`,
      beforeSha: push.beforeSha,
      afterSha: push.afterSha,
      branch: push.branch,
      changedFiles: push.changedFiles,
      duplicate: false,
      receivedAt: nowIso(),
    });
    await store.flush();
    return fail(`Repository '${push.repoFullName}' is not connected.`, 404);
  }

  if (push.branch !== repo.defaultBranch) {
    store.insert("webhooks", {
      id: uid("wh"),
      repoId: repo.id,
      deliveryId,
      event,
      valid: true,
      rejectReason: `Push to '${push.branch}' ignored (monitoring '${repo.defaultBranch}').`,
      beforeSha: push.beforeSha,
      afterSha: push.afterSha,
      branch: push.branch,
      changedFiles: push.changedFiles,
      duplicate: false,
      receivedAt: nowIso(),
    });
    await store.flush();
    return ok({ ignored: `branch ${push.branch}` });
  }

  const active = activeRunFor(repo.id);
  if (active) {
    const existing = getAnalysis(active);
    store.insert("webhooks", {
      id: uid("wh"),
      repoId: repo.id,
      deliveryId,
      event,
      valid: true,
      beforeSha: push.beforeSha,
      afterSha: push.afterSha,
      branch: push.branch,
      changedFiles: push.changedFiles,
      analysisId: existing?.id,
      duplicate: false,
      receivedAt: nowIso(),
    });
    await store.flush();
    return ok({ queued: false, runId: existing?.id, note: "analysis already running; push attached to it" });
  }

  // Record first, then analyze in the background (verifyable via polling).
  const whId = uid("wh");
  store.insert("webhooks", {
    id: whId,
    repoId: repo.id,
    deliveryId,
    event,
    valid: true,
    beforeSha: push.beforeSha,
    afterSha: push.afterSha,
    branch: push.branch,
    changedFiles: push.changedFiles,
    duplicate: false,
    receivedAt: nowIso(),
  });
  addHistory({
    id: uid("hist"),
    repoId: repo.id,
    kind: "webhook",
    actor: "github",
    message: `Push to ${push.repoFullName}@${push.branch} (${push.afterSha.slice(0, 7)}): ${push.changedFiles.length} files.`,
    meta: { deliveryId, afterSha: push.afterSha },
    createdAt: nowIso(),
  });
  await store.flush();

  void runAnalysis({
    repoId: repo.id,
    trigger: "webhook",
    headSha: push.afterSha,
    baseSha: push.beforeSha,
    actor: "github-webhook",
  })
    .then((run) => {
      store.updateById("webhooks", whId, { analysisId: run.id });
    })
    .catch((err) => {
      log.error("webhook analysis failed", {
        repoId: repo.id,
        result: err instanceof Error ? err.message : String(err),
      });
    });

  const runId = activeRunFor(repo.id);
  return ok({ queued: true, runId, files: push.changedFiles.length }, { status: 202 });
}

export async function GET(req: Request) {
  // Operational visibility: recent webhook deliveries (no secrets).
  const { searchParams } = new URL(req.url);
  const repoId = searchParams.get("repoId") || undefined;
  const rows = store
    .all("webhooks")
    .filter((w) => (!repoId || w.repoId === repoId))
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))
    .slice(0, 50);
  return ok({ webhooks: rows });
}

import { addHistory, getRepo, nowIso, store, uid } from "@/db/store";
import { applySync } from "@/lib/sentinel/pipeline";
import { isValidId } from "@/lib/sentinel/security/guards";
import { fail, ok, readJson } from "../../_util";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isValidId(params.id)) return fail("Invalid approval id.", 400);
  const approval = store.all("approvals").find((a) => a.id === params.id);
  if (!approval) return fail("Approval not found.", 404);
  return ok({ approval });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isValidId(params.id)) return fail("Invalid approval id.", 400);
  const approval = store.all("approvals").find((a) => a.id === params.id);
  if (!approval) return fail("Approval not found.", 404);
  if (approval.status !== "pending") {
    return fail(`Approval already ${approval.status}.`, 400);
  }
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Bad request.", 400);
  }
  const decision = body.decision;
  const allowDelete = body.allowDelete === true;
  if (decision !== "approve" && decision !== "reject") {
    return fail("decision must be 'approve' or 'reject'.", 400);
  }
  const repo = getRepo(approval.repoId);
  if (!repo) return fail("Repository not found.", 404);

  if (decision === "reject") {
    store.updateById("approvals", approval.id, { status: "rejected", decidedAt: nowIso() });
    addHistory({
      id: uid("hist"),
      repoId: repo.id,
      analysisId: approval.analysisId,
      kind: "approval-rejected",
      actor: "user",
      message: `Sync approval rejected (${approval.changeIds.length} changes). Nothing published.`,
      createdAt: nowIso(),
    });
    return ok({ approval: { ...approval, status: "rejected" } });
  }

  try {
    const result = await applySync(approval.repoId, approval.changeIds, allowDelete, "user");
    return ok({ version: result.version, validation: result.validation });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Approval failed.", 422);
  }
}

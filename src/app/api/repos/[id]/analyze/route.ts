import { getRepo } from "@/db/store";
import { activeRunFor, runAnalysis } from "@/lib/sentinel/pipeline";
import { isValidId } from "@/lib/sentinel/security/guards";
import { getSessionUser, loginRequiredPayload } from "@/lib/sentinel/auth";
import { fail, ok, readJson } from "../../../_util";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = getSessionUser(req);
  if (!user) return fail("Login required to run analyses.", 401, loginRequiredPayload());
  if (!isValidId(params.id)) return fail("Invalid repository id.", 400);
  const repo = getRepo(params.id);
  if (!repo) return fail("Repository not found.", 404);

  const active = activeRunFor(repo.id);
  if (active) {
    return fail("An analysis is already running for this repository.", 409, { runId: active });
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const fullRescan = body.fullRescan === true;
  const wait = body.wait === true;

  if (wait) {
    // Synchronous mode for tests, seed, and demo scripting.
    const run = await runAnalysis({
      repoId: repo.id,
      trigger: fullRescan ? "rescan" : "manual",
      fullRescan,
      actor: user.email,
    });
    return ok({ run });
  }

  // Background mode: return immediately; the client polls the run.
  void runAnalysis({
    repoId: repo.id,
    trigger: fullRescan ? "rescan" : "manual",
    fullRescan,
    actor: user.email,
  }).catch(() => {
    /* errors are persisted on the run itself */
  });
  // The run row is created synchronously inside runAnalysis before first await.
  const runId = activeRunFor(repo.id);
  return ok({ runId, status: "queued" }, { status: 202 });
}

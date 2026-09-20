/**
 * Simulates a GitHub push on a demo repository: advances the fixture
 * version and runs the REAL pipeline (same code path as a webhook).
 */
import { getRepo } from "@/db/store";
import { activeRunFor, runAnalysis } from "@/lib/sentinel/pipeline";
import { fail, ok, readJson } from "../../_util";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const repoId = typeof body.repoId === "string" ? body.repoId : "demo-fastapi";
  const wait = body.wait === true;
  const repo = getRepo(repoId);
  if (!repo || repo.provider !== "demo") {
    return fail("Demo repository not found. Run demo setup first.", 404);
  }
  if (activeRunFor(repo.id)) {
    return fail("An analysis is already running for this repository.", 409, {
      runId: activeRunFor(repo.id),
    });
  }
  if (wait) {
    const run = await runAnalysis({ repoId: repo.id, trigger: "demo", actor: "demo" });
    return ok({ run });
  }
  void runAnalysis({ repoId: repo.id, trigger: "demo", actor: "demo" }).catch(() => {});
  return ok({ runId: activeRunFor(repo.id), status: "queued" }, { status: 202 });
}

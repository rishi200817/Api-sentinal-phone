import { getChange } from "@/db/store";
import { buildContext, explainChange } from "@/lib/sentinel/agent/orchestrator";
import { isValidId } from "@/lib/sentinel/security/guards";
import { fail, ok, readJson } from "../../../_util";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isValidId(params.id)) return fail("Invalid change id.", 400);
  const change = getChange(params.id);
  if (!change) return fail("Change not found.", 404);
  let body: Record<string, unknown> = {};
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const repoId = typeof body.repoId === "string" ? body.repoId : undefined;
  try {
    const ctx = buildContext(repoId);
    const result = await explainChange(params.id, ctx);
    return ok(result);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Explanation failed.", 500);
  }
}

import { getRepo } from "@/db/store";
import { applySync } from "@/lib/sentinel/pipeline";
import { fail, ok, readJson } from "../../_util";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Bad request.", 400);
  }
  const repoId = typeof body.repoId === "string" ? body.repoId : "";
  const changeIds = Array.isArray(body.changeIds)
    ? body.changeIds.filter((x): x is string => typeof x === "string").slice(0, 200)
    : [];
  const allowDelete = body.allowDelete === true;
  const confirm = body.confirm === true;
  if (!repoId || !getRepo(repoId)) return fail("Repository not found.", 404);
  if (!changeIds.length) return fail("No changes selected.", 400);
  if (!confirm) return fail("Sync requires explicit confirmation (confirm: true).", 400);
  try {
    const result = await applySync(repoId, changeIds, allowDelete, "user");
    return ok(result);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Sync failed.", 422);
  }
}

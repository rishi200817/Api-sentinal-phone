import { getAnalysis, listAnalyses } from "@/db/store";
import { store } from "@/db/store";
import { fail, ok } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const changeId = searchParams.get("changeId") || undefined;
  const repoId = searchParams.get("repoId") || undefined;
  const analysisId = searchParams.get("analysisId") || undefined;
  try {
    let changeIds: Set<string> | null = null;
    if (changeId) changeIds = new Set([changeId]);
    else if (analysisId) {
      const run = getAnalysis(analysisId);
      if (!run) return fail("Analysis not found.", 404);
      changeIds = new Set(run.changeIds);
    } else if (repoId) {
      changeIds = new Set();
      for (const run of listAnalyses(repoId)) {
        for (const id of run.changeIds) changeIds.add(id);
      }
    }
    const all = store.all("impact");
    const findings = changeIds ? all.filter((f) => changeIds!.has(f.changeId)) : all.slice(-200);
    return ok({ findings });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to list impact.", 500);
  }
}

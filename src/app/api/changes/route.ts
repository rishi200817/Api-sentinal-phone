import { getAnalysis, listAnalyses } from "@/db/store";
import { store } from "@/db/store";
import { fail, ok } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const analysisId = searchParams.get("analysisId") || undefined;
  const repoId = searchParams.get("repoId") || undefined;
  try {
    let ids: Set<string> | null = null;
    if (analysisId) {
      const run = getAnalysis(analysisId);
      if (!run) return fail("Analysis not found.", 404);
      ids = new Set(run.changeIds);
    } else if (repoId) {
      ids = new Set();
      for (const run of listAnalyses(repoId)) {
        for (const id of run.changeIds) ids.add(id);
      }
    }
    const all = store.all("changes");
    const changes = (ids ? all.filter((c) => ids!.has(c.id)) : all).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1
    );
    return ok({ changes });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to list changes.", 500);
  }
}

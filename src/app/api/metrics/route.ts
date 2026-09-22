import { store } from "@/db/store";
import { fail, ok } from "../_util";

export const dynamic = "force-dynamic";

/** Internal observability metrics derived from persisted runs. */
export async function GET() {
  try {
    const runs = store.all("analyses");
    const done = runs.filter((r) => r.status === "completed");
    const failed = runs.filter((r) => r.status === "failed").length;
    const durations = done.map((r) => r.durationMs ?? 0).filter((d) => d > 0);
    const avg = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;
    const filesScanned = done.reduce((a, r) => a + (r.scanLimits?.filesScanned ?? 0), 0);
    const apiFiles = done.reduce((a, r) => a + (r.scanLimits?.apiFilesAnalyzed ?? 0), 0);
    const endpoints = done.reduce((a, r) => a + r.endpoints.length, 0);
    const changes = store.all("changes").length;
    const validations = done.filter((r) => r.validation).length;
    const aiRuns = store.all("history").filter((h) => h.kind === "agent-run").length;
    return ok({
      metrics: {
        totalRuns: runs.length,
        completedRuns: done.length,
        failedRuns: failed,
        avgDurationMs: avg,
        filesScanned,
        apiFilesAnalyzed: apiFiles,
        endpointsExtracted: endpoints,
        changesDetected: changes,
        validationsRun: validations,
        agentRuns: aiRuns,
      },
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Metrics failed.", 500);
  }
}

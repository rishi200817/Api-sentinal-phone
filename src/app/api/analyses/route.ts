import { listAnalyses } from "@/db/store";
import { fail, ok } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repoId = searchParams.get("repoId") || undefined;
  try {
    const runs = listAnalyses(repoId).map((r) => ({
      ...r,
      // endpoints can be large; list view keeps counts + stages
      endpoints: undefined,
      endpointCount: r.endpoints.length,
    }));
    return ok({ runs });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to list analyses.", 500);
  }
}

import { latestOpenApi } from "@/db/store";
import { store } from "@/db/store";
import { fail, ok } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repoId = searchParams.get("repoId");
  const versionParam = searchParams.get("version");
  if (!repoId) return fail("repoId is required.", 400);
  try {
    if (versionParam === "list") {
      const versions = store
        .all("openapi")
        .filter((o) => o.repoId === repoId)
        .sort((a, b) => b.version - a.version)
        .map((o) => ({
          id: o.id,
          version: o.version,
          source: o.source,
          analysisId: o.analysisId,
          valid: o.validation.valid,
          operations: o.validation.operations,
          createdAt: o.createdAt,
        }));
      return ok({ versions });
    }
    const current = latestOpenApi(repoId);
    if (!current) return fail("No published OpenAPI for this repository yet.", 404);
    return ok({ openapi: current });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to load OpenAPI.", 500);
  }
}

import { getEndpoints, listRepos } from "@/db/store";
import { fail, ok } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repoId = searchParams.get("repoId") || undefined;
  try {
    if (repoId) {
      return ok({ endpoints: getEndpoints(repoId) });
    }
    const all = listRepos().flatMap((r) =>
      getEndpoints(r.id).map((e) => ({ ...e, repoId: r.id }))
    );
    return ok({ endpoints: all });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to list endpoints.", 500);
  }
}

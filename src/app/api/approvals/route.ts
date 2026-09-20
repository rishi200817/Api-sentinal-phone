import { store } from "@/db/store";
import { fail, ok } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repoId = searchParams.get("repoId") || undefined;
  const status = searchParams.get("status") || undefined;
  try {
    const approvals = store
      .all("approvals")
      .filter((a) => (!repoId || a.repoId === repoId) && (!status || a.status === status))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return ok({ approvals });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to list approvals.", 500);
  }
}

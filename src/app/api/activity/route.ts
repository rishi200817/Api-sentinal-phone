import { listHistory } from "@/db/store";
import { fail, ok } from "../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const repoId = searchParams.get("repoId") || undefined;
  try {
    return ok({ events: listHistory(repoId || undefined) });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to list activity.", 500);
  }
}

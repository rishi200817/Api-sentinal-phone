import { getChange } from "@/db/store";
import { store } from "@/db/store";
import { isValidId } from "@/lib/sentinel/security/guards";
import { fail, ok } from "../../_util";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isValidId(params.id)) return fail("Invalid change id.", 400);
  const change = getChange(params.id);
  if (!change) return fail("Change not found.", 404);
  const impact = store.all("impact").filter((i) => i.changeId === change.id);
  return ok({ change, impact });
}

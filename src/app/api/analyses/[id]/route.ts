import { getAnalysis } from "@/db/store";
import { isValidId } from "@/lib/sentinel/security/guards";
import { fail, ok } from "../../_util";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isValidId(params.id)) return fail("Invalid analysis id.", 400);
  const run = getAnalysis(params.id);
  if (!run) return fail("Analysis not found.", 404);
  return ok({ run });
}

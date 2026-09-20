import { getRepo } from "@/db/store";
import { activeRunFor, resetRepoData } from "@/lib/sentinel/pipeline";
import { isValidId } from "@/lib/sentinel/security/guards";
import { fail, ok } from "../../../_util";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!isValidId(params.id)) return fail("Invalid repository id.", 400);
  const repo = getRepo(params.id);
  if (!repo) return fail("Repository not found.", 404);
  if (activeRunFor(repo.id)) {
    return fail("Cannot reset while an analysis is running.", 409);
  }
  resetRepoData(repo.id);
  return ok({ reset: repo.id });
}

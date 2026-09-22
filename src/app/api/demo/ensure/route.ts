import { ensureDemoRepos } from "@/lib/sentinel/pipeline";
import { getSessionUser, loginRequiredPayload } from "@/lib/sentinel/auth";
import { fail, ok } from "../../_util";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!getSessionUser(req)) return fail("Login required for demo setup.", 401, loginRequiredPayload());
  try {
    const repos = ensureDemoRepos();
    return ok({ repos });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Demo setup failed.", 500);
  }
}

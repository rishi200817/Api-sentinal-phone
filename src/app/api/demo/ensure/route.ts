import { ensureDemoRepos } from "@/lib/sentinel/pipeline";
import { fail, ok } from "../../_util";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const repos = ensureDemoRepos();
    return ok({ repos });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Demo setup failed.", 500);
  }
}

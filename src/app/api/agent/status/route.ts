import { providerStatuses } from "@/lib/sentinel/agent/orchestrator";
import { fail, ok } from "../../_util";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { statuses, active } = await providerStatuses();
    return ok({ providers: statuses, active });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Provider probe failed.", 500);
  }
}

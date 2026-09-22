/** Current session: the logged-in user (or null) + provider availability. */
import { getSessionUser, providersStatus } from "@/lib/sentinel/auth";
import { ok } from "../../_util";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return ok({ user: getSessionUser(req), providers: providersStatus() });
}

/** Logout: revoke the current session and clear the cookie. */
import { clearSessionCookie, revokeSession } from "@/lib/sentinel/auth";
import { ok } from "../../_util";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  revokeSession(req);
  const res = ok({ loggedOut: true });
  res.headers.set("Set-Cookie", clearSessionCookie());
  return res;
}

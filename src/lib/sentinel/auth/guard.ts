/**
 * Route guard for write endpoints. Viewing stays public; mutations require
 * a valid session. Usage at the top of a route handler:
 *
 *   const user = getSessionUser(req);
 *   if (!user) return loginRequired();
 */
import type { SafeUser } from "@/lib/sentinel/types";
import { getSessionUser } from "./session";

export { getSessionUser };
export type { SafeUser };

export const LOGIN_REQUIRED = "loginRequired" as const;

/** Payload marker the browser client watches to redirect to /login. */
export function loginRequiredPayload(): { [LOGIN_REQUIRED]: true } {
  return { [LOGIN_REQUIRED]: true };
}

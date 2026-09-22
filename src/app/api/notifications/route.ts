import { listNotifications, store } from "@/db/store";
import { getSessionUser, loginRequiredPayload } from "@/lib/sentinel/auth";
import { fail, ok, readJson } from "../_util";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const notifications = listNotifications().slice(0, 100);
    const unread = notifications.filter((n) => !n.read).length;
    return ok({ notifications, unread });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to list notifications.", 500);
  }
}

export async function PATCH(req: Request) {
  if (!getSessionUser(req)) return fail("Login required to update notifications.", 401, loginRequiredPayload());
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Bad request.", 400);
  }
  if (body.markAllRead === true) {
    for (const n of store.all("notifications")) {
      if (!n.read) store.updateById("notifications", n.id, { read: true });
    }
    return ok({ updated: "all" });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const found = store.all("notifications").find((n) => n.id === id);
  if (!found) return fail("Notification not found.", 404);
  store.updateById("notifications", id, { read: true });
  return ok({ updated: id });
}

/**
 * In-app notification center (server side).
 * Creates honest notifications from real pipeline outcomes only.
 * Browser push delivery (Notification API) is handled client-side with
 * explicit permission flow — never claimed if unsupported.
 */
import type { AnalysisRun, ApiChange, Repository } from "../types";
import { addNotification, nowIso, uid } from "@/db/store";
import { BREAKING_LABEL } from "../impact/risk";

export function notifyBreakingChanges(
  repo: Repository,
  run: AnalysisRun,
  changes: ApiChange[]
): string[] {
  const ids: string[] = [];
  const severe = changes.filter(
    (c) => c.severity === "HIGH" || c.severity === "CRITICAL"
  );
  if (severe.length) {
    const top = severe[0];
    const id = uid("notif");
    addNotification({
      id,
      repoId: repo.id,
      kind: "breaking",
      title: `Breaking API change in ${repo.owner}/${repo.repo}`,
      body: `${top.method} ${top.path} — ${top.detail.slice(0, 180)} (${BREAKING_LABEL[top.breaking]}${severe.length > 1 ? `, +${severe.length - 1} more` : ""})`,
      changeIds: severe.map((c) => c.id),
      analysisId: run.id,
      read: false,
      createdAt: nowIso(),
    });
    ids.push(id);
  }
  const rest = changes.filter(
    (c) => c.severity !== "HIGH" && c.severity !== "CRITICAL"
  );
  if (rest.length) {
    const id = uid("notif");
    addNotification({
      id,
      repoId: repo.id,
      kind: "change",
      title: `${rest.length} API change${rest.length === 1 ? "" : "s"} detected`,
      body: rest
        .slice(0, 3)
        .map((c) => `${c.method} ${c.path} (${c.type})`)
        .join(" · "),
      changeIds: rest.map((c) => c.id),
      analysisId: run.id,
      read: false,
      createdAt: nowIso(),
    });
    ids.push(id);
  }
  return ids;
}

export function notifyValidationFailed(
  repo: Repository,
  run: AnalysisRun,
  errors: { path: string; message: string }[]
): string {
  const id = uid("notif");
  addNotification({
    id,
    repoId: repo.id,
    kind: "validation",
    title: "OpenAPI validation failed — publish blocked",
    body: `Generated spec rejected: ${(errors[0]?.message ?? "unknown error").slice(0, 200)}`,
    changeIds: [],
    analysisId: run.id,
    read: false,
    createdAt: nowIso(),
  });
  return id;
}

export function notifyPublished(
  repo: Repository,
  run: AnalysisRun,
  version: number,
  ops: number
): string {
  const id = uid("notif");
  addNotification({
    id,
    repoId: repo.id,
    kind: "sync",
    title: `Documentation published (v${version})`,
    body: `${ops} operations validated and published for ${repo.owner}/${repo.repo}.`,
    changeIds: [...run.changeIds],
    analysisId: run.id,
    read: false,
    createdAt: nowIso(),
  });
  return id;
}

export function notifySystem(message: string, repoId?: string): string {
  const id = uid("notif");
  addNotification({
    id,
    repoId,
    kind: "system",
    title: "Sentinel",
    body: message,
    changeIds: [],
    read: false,
    createdAt: nowIso(),
  });
  return id;
}

/** GitHub webhook signature verification + push payload normalization. */
import crypto from "node:crypto";
import { clampString } from "../security/guards";

export function webhookSecret(): string {
  return process.env.GITHUB_WEBHOOK_SECRET || "";
}

/** Verify X-Hub-Signature-256 over the raw body. */
export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  secret: string = webhookSecret()
): { valid: boolean; reason?: string } {
  if (!secret) {
    return { valid: false, reason: "No webhook secret configured on server." };
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return { valid: false, reason: "Missing or malformed X-Hub-Signature-256 header." };
  }
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: "Signature mismatch — payload rejected." };
  }
  return { valid: true };
}

export interface NormalizedPush {
  repoFullName: string;
  ref: string;
  branch: string;
  beforeSha: string;
  afterSha: string;
  compareUrl?: string;
  changedFiles: string[];
  pusher?: string;
  commitMessages: string[];
}

export function normalizePushEvent(payload: unknown): NormalizedPush | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const repo = p.repository as Record<string, unknown> | undefined;
  if (!repo || typeof repo.full_name !== "string") return null;
  if (typeof p.ref !== "string" || typeof p.after !== "string") return null;
  // branch deletes / zero SHAs carry no analyzable content
  if (/^0+$/.test(p.after)) return null;
  const branch = p.ref.replace(/^refs\/heads\//, "");
  const files = new Set<string>();
  const commits = Array.isArray(p.commits) ? p.commits : [];
  const messages: string[] = [];
  for (const c of commits as Record<string, unknown>[]) {
    for (const k of ["added", "modified", "removed"] as const) {
      const arr = c[k];
      if (Array.isArray(arr)) {
        for (const f of arr) {
          if (typeof f === "string") files.add(clampString(f, 500));
        }
      }
    }
    if (typeof c.message === "string") messages.push(c.message.slice(0, 300));
  }
  return {
    repoFullName: repo.full_name,
    ref: p.ref,
    branch: clampString(branch, 200),
    beforeSha: typeof p.before === "string" ? p.before : "",
    afterSha: p.after,
    compareUrl: typeof p.compare === "string" ? p.compare : undefined,
    changedFiles: [...files].slice(0, 1000),
    pusher:
      typeof (p.pusher as Record<string, unknown> | undefined)?.name === "string"
        ? ((p.pusher as Record<string, unknown>).name as string)
        : undefined,
    commitMessages: messages.slice(0, 20),
  };
}

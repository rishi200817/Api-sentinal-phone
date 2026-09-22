import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizePushEvent, verifySignature } from "@/lib/sentinel/git/webhook";
import { analyzeImpact } from "@/lib/sentinel/impact/analyzer";
import type { ApiChange } from "@/lib/sentinel/types";

describe("webhook signatures", () => {
  const secret = "test-secret-123";
  const body = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }));

  it("accepts valid signatures", () => {
    const sig = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySignature(body, sig, secret).valid).toBe(true);
  });

  it("rejects tampered bodies and missing headers", () => {
    const sig = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySignature(Buffer.from("tampered"), sig, secret).valid).toBe(false);
    expect(verifySignature(body, null, secret).valid).toBe(false);
    expect(verifySignature(body, "sha256=deadbeef", secret).valid).toBe(false);
  });

  it("fails closed without a configured secret", () => {
    expect(verifySignature(body, "sha256=x", "").valid).toBe(false);
  });
});

describe("push normalization", () => {
  it("extracts branch, shas, and changed files", () => {
    const push = normalizePushEvent({
      ref: "refs/heads/main",
      before: "a".repeat(40),
      after: "b".repeat(40),
      repository: { full_name: "acme/api" },
      pusher: { name: "ada" },
      commits: [
        { message: "add device", added: ["x.ts"], modified: ["y.ts"], removed: [] },
      ],
    });
    expect(push?.branch).toBe("main");
    expect(push?.changedFiles.sort()).toEqual(["x.ts", "y.ts"]);
    expect(push?.pusher).toBe("ada");
  });

  it("rejects branch deletions", () => {
    expect(
      normalizePushEvent({ ref: "refs/heads/x", before: "a", after: "0".repeat(40), repository: { full_name: "a/b" } })
    ).toBeNull();
  });
});

describe("impact analysis", () => {
  const change = {
    id: "c1",
    type: "REQUEST_SCHEMA_CHANGED",
    method: "POST",
    path: "/api/auth/login",
    fieldChanges: [{ kind: "field-added", location: "requestBody", field: "deviceId", note: "added" }],
    before: { sourceFile: "auth.py" },
    after: { sourceFile: "auth.py" },
  } as unknown as ApiChange;

  it("finds consumers with confidence tiers and skips self-references", () => {
    const files = new Map<string, string>([
      ["auth.py", "@router.post('/login')"],
      ["web/api.ts", `fetch("/api/auth/login", { body: JSON.stringify({ deviceId }) })`],
      ["docs.md", "see /api/auth/login for details"],
    ]);
    const findings = analyzeImpact([change], files);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.every((f) => f.consumerFile !== "auth.py")).toBe(true);
    const kinds = findings.map((f) => f.matchKind);
    expect(kinds).toContain("verified-reference");
  });
});

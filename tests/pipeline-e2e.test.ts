/**
 * End-to-end: demo FastAPI repo through the REAL pipeline.
 * v1 baseline -> v2 (deviceId required + DELETE user) -> approval -> publish.
 */
process.env.SENTINEL_DATA_DIR = "/tmp/sentinel-test-data";

import { afterAll, describe, expect, it } from "vitest";
import { store } from "@/db/store";
import { applySync, ensureDemoRepos, previewSync, runAnalysis } from "@/lib/sentinel/pipeline";
import { askSentinel, buildContext } from "@/lib/sentinel/agent/orchestrator";

describe("pipeline e2e (demo fastapi)", () => {
  it("baselines v1 with zero changes and a published spec", async () => {
    store.resetForTests();
    const [repo] = ensureDemoRepos().filter((r) => r.id === "demo-fastapi");
    const run = await runAnalysis({ repoId: repo.id, trigger: "manual", actor: "test" });
    expect(run.status).toBe("completed");
    expect(run.changeIds).toHaveLength(0);
    expect(run.endpoints.length).toBeGreaterThanOrEqual(6);
    expect(run.validation?.valid).toBe(true);

    const versions = store.all("openapi").filter((o) => o.repoId === repo.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].source).toBe("generated");
  }, 60000);

  it("detects the v2 deviceId + delete-user changes with real risk", async () => {
    const run = await runAnalysis({ repoId: "demo-fastapi", trigger: "demo", actor: "test" });
    expect(run.status).toBe("completed");
    expect(run.baseSha).toBe("demo-v1");
    expect(run.headSha).toBe("demo-v2");

    const changes = store.all("changes").filter((c) => run.changeIds.includes(c.id));
    expect(changes).toHaveLength(2);

    const req = changes.find((c) => c.type === "REQUEST_SCHEMA_CHANGED")!;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/api/auth/login");
    expect(req.severity).toBe("HIGH");
    expect(req.fieldChanges.some((f) => f.field === "deviceId" && f.kind === "field-added")).toBe(true);

    const added = changes.find((c) => c.type === "NEW_ENDPOINT")!;
    expect(added.id).toBeTruthy();
    expect(`${added.method} ${added.path}`).toBe("DELETE /api/users/{user_id}");

    // impact executed
    const impact = store.all("impact").filter((i) => run.changeIds.includes(i.changeId));
    expect(impact.length).toBeGreaterThan(0);

    // AI summary grounded + truthful provider
    expect(run.aiSummary).toMatch(/deviceId|login/i);
    expect(run.aiProvider).toMatch(/deterministic|local|remote/);

    // manual policy -> approval pending, nothing auto-published
    const approvals = store.all("approvals").filter((a) => a.repoId === "demo-fastapi" && a.status === "pending");
    expect(approvals).toHaveLength(1);
    expect(approvals[0].patchPreview).toMatch(/deviceId/);

    // breaking notification generated
    const notifs = store.all("notifications").filter((n) => n.analysisId === run.id);
    expect(notifs.some((n) => n.kind === "breaking")).toBe(true);

    // assistant answers from the actual detected result
    const ctx = buildContext("demo-fastapi", run.id);
    const answer = await askSentinel("What changed?", ctx);
    expect(answer.answer).toMatch(/deviceId|login/i);
    expect(answer.grounded).toBe(true);

    // preview + approve -> validated publish
    const preview = await previewSync("demo-fastapi", run.changeIds, false);
    expect(preview.validation.valid).toBe(true);
    expect(preview.preview).toMatch(/deviceId/);
    const applied = await applySync("demo-fastapi", run.changeIds, false, "test");
    expect(applied.validation.valid).toBe(true);
    expect(applied.version).toBe(2);

    const latest = store.all("openapi").filter((o) => o.repoId === "demo-fastapi").sort((a, b) => b.version - a.version)[0];
    const paths = latest.spec.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(paths["/api/users/{user_id}"].delete).toBeTruthy();
    const loginOp = paths["/api/auth/login"].post;
    const schema = ((loginOp.requestBody as Record<string, unknown>).content as Record<string, Record<string, unknown>>)["application/json"].schema as Record<string, unknown>;
    expect(schema.required).toContain("deviceId");
  }, 90000);

  afterAll(async () => {
    await store.flush();
  });
});

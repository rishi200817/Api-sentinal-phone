/**
 * Sync-gate tests: the pipeline must refuse to publish an invalid spec,
 * and must publish a valid one. Uses the real applySync path.
 */
process.env.SENTINEL_DATA_DIR = "/tmp/sentinel-test-sync";

import { describe, expect, it } from "vitest";
import { store } from "@/db/store";
import { applySync } from "@/lib/sentinel/pipeline";
import type { EndpointContract } from "@/lib/sentinel/types";

function ep(partial: Partial<EndpointContract> & { method: EndpointContract["method"]; path: string }): EndpointContract {
  return {
    id: `${partial.method} ${partial.path}`,
    sourceFile: "app.py",
    sourceLine: 1,
    framework: "fastapi",
    pathParams: [],
    queryParams: [],
    responses: [{ status: "200", description: "ok", fields: [], origin: "t", confidence: "detected" }],
    auth: { required: false, schemes: [], origin: "t", confidence: "inferred" },
    confidence: "detected",
    ...partial,
  };
}

function seedRepo(id: string) {
  store.resetForTests();
  store.replace("repositories", [
    {
      id, name: id, owner: "t", repo: id, url: `https://github.com/t/${id}`,
      defaultBranch: "main", provider: "github", status: "connected",
      lastSha: null, lastAnalysisId: null, webhookEnabled: false,
      webhookSecretSet: false, autoSyncPolicy: "manual",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
  ]);
}

describe("sync gate", () => {
  it("rejects publishing an invalid spec and publishes nothing", async () => {
    seedRepo("bad-repo");
    const bad = ep({ method: "GET", path: "/things/{thing_id}", pathParams: [] });
    store.replace("endpoints", [{ repoId: "bad-repo", items: [bad], updatedAt: new Date().toISOString() }]);
    const change = {
      id: "chg_bad", type: "NEW_ENDPOINT", severity: "LOW", breaking: "non-breaking",
      method: "GET", path: "/things/{thing_id}", summary: "s", detail: "d",
      fieldChanges: [], before: null, after: bad, recommendation: "r",
      evidence: [], synced: false, createdAt: new Date().toISOString(),
    } as const;
    store.replace("changes", [change as unknown as (typeof store.all extends never ? never : import("@/lib/sentinel/types").ApiChange)]);
    await expect(applySync("bad-repo", ["chg_bad"], false, "test")).rejects.toThrow(/INVALID|invalid/i);
    expect(store.all("openapi").filter((o) => o.repoId === "bad-repo")).toHaveLength(0);
    expect(store.all("changes")[0].synced).toBe(false);
  });

  it("publishes a valid spec", async () => {
    seedRepo("good-repo");
    const good = ep({
      method: "GET", path: "/things/{thing_id}",
      pathParams: [{ name: "thing_id", in: "path", required: true, type: "integer", origin: "t", confidence: "detected" }],
    });
    store.replace("endpoints", [{ repoId: "good-repo", items: [good], updatedAt: new Date().toISOString() }]);
    const change = {
      id: "chg_good", type: "NEW_ENDPOINT", severity: "LOW", breaking: "non-breaking",
      method: "GET", path: "/things/{thing_id}", summary: "s", detail: "d",
      fieldChanges: [], before: null, after: good, recommendation: "r",
      evidence: [], synced: false, createdAt: new Date().toISOString(),
    } as const;
    store.replace("changes", [change as unknown as import("@/lib/sentinel/types").ApiChange]);
    const out = await applySync("good-repo", ["chg_good"], false, "test");
    expect(out.validation.valid).toBe(true);
    expect(out.version).toBe(1);
    expect(store.all("changes")[0].synced).toBe(true);
  });
});

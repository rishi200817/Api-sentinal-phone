import { describe, expect, it } from "vitest";
import { diffContracts } from "@/lib/sentinel/diff/engine";
import { classifyChange } from "@/lib/sentinel/impact/risk";
import type { EndpointContract } from "@/lib/sentinel/types";

function ep(partial: Partial<EndpointContract> & { method: EndpointContract["method"]; path: string }): EndpointContract {
  return {
    id: `${partial.method} ${partial.path}`,
    controller: "t",
    sourceFile: "a.ts",
    sourceLine: 1,
    framework: "express",
    pathParams: [],
    queryParams: [],
    responses: [{ status: "200", fields: [], origin: "t", confidence: "detected" }],
    auth: { required: false, schemes: [], origin: "t", confidence: "inferred" },
    confidence: "detected",
    ...partial,
  };
}

describe("diff engine", () => {
  it("detects NEW and DELETED endpoints", () => {
    const changes = diffContracts([ep({ method: "GET", path: "/a" })], [ep({ method: "GET", path: "/b" })]);
    expect(changes.map((c) => c.type).sort()).toEqual(["DELETED_ENDPOINT", "NEW_ENDPOINT"]);
    expect(changes.find((c) => c.type === "DELETED_ENDPOINT")?.severity).toBe("CRITICAL");
  });

  it("detects request schema changes (required field added)", () => {
    const before = ep({
      method: "POST", path: "/login",
      requestBody: { contentType: "application/json", present: true, origin: "t", confidence: "detected",
        fields: [{ name: "username", type: "string", required: true, origin: "t", confidence: "detected" }] },
    });
    const after = ep({
      method: "POST", path: "/login",
      requestBody: { contentType: "application/json", present: true, origin: "t", confidence: "detected",
        fields: [
          { name: "username", type: "string", required: true, origin: "t", confidence: "detected" },
          { name: "deviceId", type: "string", required: true, origin: "t", confidence: "detected" },
        ] },
    });
    const changes = diffContracts([before], [after]);
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("REQUEST_SCHEMA_CHANGED");
    expect(changes[0].severity).toBe("HIGH");
    expect(changes[0].breaking).toBe("potentially-breaking");
    expect(changes[0].fieldChanges[0].kind).toBe("field-added");
  });

  it("detects response, parameter, method, and auth changes", () => {
    const b = ep({
      method: "GET", path: "/u",
      queryParams: [{ name: "q", in: "query", required: false, type: "string", origin: "t", confidence: "detected" }],
      responses: [{ status: "200", fields: [{ name: "a", type: "string", required: true, origin: "t", confidence: "detected" }], origin: "t", confidence: "detected" }],
    });
    const a = ep({
      method: "GET", path: "/u",
      queryParams: [{ name: "q", in: "query", required: true, type: "string", origin: "t", confidence: "detected" }],
      responses: [{ status: "200", fields: [], origin: "t", confidence: "detected" }],
      auth: { required: true, schemes: ["jwt"], origin: "t", confidence: "detected" },
    });
    const types = diffContracts([b], [a]).map((c) => c.type).sort();
    expect(types).toEqual(["AUTH_CHANGED", "PARAMETER_CHANGED", "RESPONSE_SCHEMA_CHANGED"]);

    const m = diffContracts([ep({ method: "GET", path: "/m" })], [ep({ method: "POST", path: "/m" })]);
    expect(m[0].type).toBe("METHOD_CHANGED");
    expect(m[0].severity).toBe("CRITICAL");
  });

  it("returns no changes for identical contracts", () => {
    expect(diffContracts([ep({ method: "GET", path: "/a" })], [ep({ method: "GET", path: "/a" })])).toHaveLength(0);
  });
});

describe("risk classifier", () => {
  it("classifies the full matrix honestly", () => {
    expect(classifyChange("NEW_ENDPOINT", [])).toEqual({ severity: "LOW", breaking: "non-breaking" });
    expect(classifyChange("DELETED_ENDPOINT", []).severity).toBe("CRITICAL");
    expect(classifyChange("METHOD_CHANGED", []).breaking).toBe("likely-breaking");
    expect(
      classifyChange("AUTH_CHANGED", [{ kind: "auth-changed", location: "security", after: "no auth", breaking: "likely-breaking", note: "x" }]).severity
    ).toBe("CRITICAL");
    expect(
      classifyChange("REQUEST_SCHEMA_CHANGED", [{ kind: "field-added", location: "requestBody", field: "n", after: "string, optional", breaking: "non-breaking", note: "x" }]).severity
    ).toBe("LOW");
  });
});

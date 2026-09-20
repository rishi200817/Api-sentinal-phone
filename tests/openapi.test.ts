import { describe, expect, it } from "vitest";
import { coverageOf, parseSpec } from "@/lib/sentinel/openapi/reader";
import { buildFreshSpec, endpointToOperation, patchSpec } from "@/lib/sentinel/openapi/writer";
import { validateSpec } from "@/lib/sentinel/openapi/validator";
import type { EndpointContract } from "@/lib/sentinel/types";

function ep(): EndpointContract {
  return {
    id: "POST /api/auth/login",
    method: "POST",
    path: "/api/auth/login",
    sourceFile: "auth.py",
    sourceLine: 10,
    framework: "fastapi",
    pathParams: [],
    queryParams: [],
    requestBody: {
      contentType: "application/json",
      present: true,
      origin: "t",
      confidence: "detected",
      fields: [
        { name: "username", type: "string", required: true, origin: "t", confidence: "detected" },
        { name: "deviceId", type: "string", required: true, origin: "t", confidence: "detected" },
      ],
    },
    responses: [{ status: "201", description: "Success", fields: [], origin: "t", confidence: "detected" }],
    auth: { required: false, schemes: [], origin: "t", confidence: "inferred" },
    summary: "User login",
    confidence: "detected",
  };
}

const BASE_YAML = `openapi: 3.0.3
info:
  title: T
  version: '1'
servers:
  - url: https://x
paths:
  /health:
    get:
      summary: H
      responses:
        '200':
          description: ok
`;

describe("openapi reader", () => {
  it("parses yaml and json specs", () => {
    const y = parseSpec(BASE_YAML);
    expect(y.version).toBe("3.0.3");
    expect(y.operations).toHaveLength(1);
    const j = parseSpec(JSON.stringify({ openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {} }));
    expect(j.sourceFormat).toBe("json");
  });

  it("measures coverage", () => {
    const { doc } = parseSpec(BASE_YAML);
    const cov = coverageOf(doc, [{ method: "GET", path: "/health" }, { method: "POST", path: "/nope" }]);
    expect(cov.documented).toBe(1);
    expect(cov.missing).toEqual(["POST /nope"]);
  });
});

describe("openapi writer", () => {
  it("patches minimally and preserves unrelated content", () => {
    const { doc } = parseSpec(BASE_YAML);
    const out = patchSpec(doc, [ep()]);
    expect(out.added).toEqual(["POST /api/auth/login"]);
    const paths = out.doc.paths as Record<string, unknown>;
    expect(paths["/health"]).toBeTruthy();
    expect((out.doc.servers as unknown[])).toHaveLength(1);
    const op = ((paths["/api/auth/login"] as Record<string, unknown>).post as Record<string, unknown>);
    expect(op.summary).toBe("User login");
  });

  it("emits required fields and path params correctly", () => {
    const op = endpointToOperation(ep());
    const req = (op.requestBody as Record<string, unknown>).content as Record<string, unknown>;
    const schema = ((req["application/json"] as Record<string, unknown>).schema as Record<string, unknown>);
    expect(schema.required).toEqual(["username", "deviceId"]);
  });

  it("builds a fresh spec and validates it", async () => {
    const doc = buildFreshSpec("T", [ep()]);
    const v = await validateSpec(doc);
    expect(v.valid).toBe(true);
    expect(v.operations).toBe(1);
    expect(v.engine).toContain("sentinel-structural");
    expect(v.engine).toContain("@apidevtools/swagger-parser");
  });
});

describe("openapi validator", () => {
  it("rejects invalid specs with exact errors", async () => {
    const v = await validateSpec({ openapi: "3.0.3", info: { title: "t" }, paths: { broken: { get: {} } } });
    expect(v.valid).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });

  it("rejects path templates without matching params", async () => {
    const v = await validateSpec({
      openapi: "3.0.3",
      info: { title: "t", version: "1" },
      paths: { "/u/{id}": { get: { responses: { "200": { description: "ok" } } } } },
    });
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.message.includes("{id}"))).toBe(true);
  });
});

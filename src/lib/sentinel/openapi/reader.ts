/** OpenAPI 3.x reading: YAML/JSON parse + operation extraction. */
import yaml from "js-yaml";

export interface OpenApiOperation {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  parameters: { name: string; in: string; required: boolean; type?: string }[];
  requestFields: { name: string; required: boolean; type?: string }[];
  responseStatuses: string[];
}

export interface ParsedSpec {
  doc: Record<string, unknown>;
  version: string;
  operations: OpenApiOperation[];
  sourceFormat: "yaml" | "json";
}

export function parseSpec(text: string): ParsedSpec {
  const trimmed = text.trim();
  let doc: unknown;
  let format: "yaml" | "json" = "yaml";
  if (trimmed.startsWith("{")) {
    doc = JSON.parse(trimmed);
    format = "json";
  } else {
    doc = yaml.load(trimmed);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("OpenAPI document must be a YAML/JSON object.");
  }
  const d = doc as Record<string, unknown>;
  const version = typeof d.openapi === "string" ? d.openapi : "";
  const operations = extractOperations(d);
  return { doc: d, version, operations, sourceFormat: format };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function extractOperations(doc: Record<string, unknown>): OpenApiOperation[] {
  const out: OpenApiOperation[] = [];
  const paths = asRecord(doc.paths);
  if (!paths) return out;
  const verbs = ["get", "post", "put", "patch", "delete", "head", "options"];
  for (const [path, item] of Object.entries(paths)) {
    const itemRec = asRecord(item);
    if (!itemRec) continue;
    const pathParams = Array.isArray(itemRec.parameters)
      ? (itemRec.parameters as unknown[])
      : [];
    for (const verb of verbs) {
      const op = asRecord(itemRec[verb]);
      if (!op) continue;
      const params: OpenApiOperation["parameters"] = [];
      const allParams = [...pathParams, ...(Array.isArray(op.parameters) ? op.parameters : [])];
      for (const p of allParams) {
        const pr = asRecord(p);
        if (!pr || typeof pr.name !== "string") continue;
        const schema = asRecord(pr.schema);
        params.push({
          name: pr.name,
          in: typeof pr.in === "string" ? pr.in : "query",
          required: pr.required === true || pr.in === "path",
          type: typeof schema?.type === "string" ? schema.type : undefined,
        });
      }
      const requestFields: OpenApiOperation["requestFields"] = [];
      const reqBody = asRecord(op.requestBody);
      const content = reqBody ? asRecord(reqBody.content) : null;
      const jsonMedia =
        content?.["application/json"] ?? content?.[Object.keys(content ?? {})[0] ?? ""];
      const mediaRec = asRecord(jsonMedia);
      const schema = mediaRec ? asRecord(mediaRec.schema) : null;
      const props = schema ? asRecord(schema.properties) : null;
      const requiredList = Array.isArray(schema?.required)
        ? (schema!.required as unknown[]).map(String)
        : [];
      if (props) {
        for (const [name, def] of Object.entries(props)) {
          const dr = asRecord(def);
          requestFields.push({
            name,
            required: requiredList.includes(name),
            type: typeof dr?.type === "string" ? dr.type : undefined,
          });
        }
      }
      const responses = asRecord(op.responses);
      const responseStatuses = responses ? Object.keys(responses) : [];
      out.push({
        method: verb.toUpperCase(),
        path,
        operationId: typeof op.operationId === "string" ? op.operationId : undefined,
        summary: typeof op.summary === "string" ? op.summary : undefined,
        parameters: params,
        requestFields,
        responseStatuses,
      });
    }
  }
  return out;
}

/** Coverage: which live endpoints have a matching documented operation. */
export function coverageOf(
  doc: Record<string, unknown>,
  endpoints: { method: string; path: string }[]
): { documented: number; total: number; missing: string[] } {
  const ops = new Set(
    extractOperations(doc).map((o) => `${o.method} ${o.path}`)
  );
  const missing: string[] = [];
  let documented = 0;
  for (const e of endpoints) {
    if (ops.has(`${e.method} ${e.path}`)) documented++;
    else missing.push(`${e.method} ${e.path}`);
  }
  return { documented, total: endpoints.length, missing };
}

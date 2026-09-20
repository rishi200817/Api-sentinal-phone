/**
 * Minimal OpenAPI patching: merge detected endpoints into an existing
 * document while preserving info/servers/tags/security/examples and all
 * unrelated paths. Never regenerates the whole document.
 */
import type { ApiParam, EndpointContract, SchemaField } from "../types";
import { parseSpec } from "./reader";

function fieldToSchema(f: SchemaField): Record<string, unknown> {
  const s: Record<string, unknown> = { type: f.type || "string" };
  if (f.description) s.description = f.description;
  if (f.children?.length) {
    s.type = "object";
    s.properties = Object.fromEntries(f.children.map((c) => [c.name, fieldToSchema(c)]));
    const req = f.children.filter((c) => c.required).map((c) => c.name);
    if (req.length) s.required = req;
  }
  if (f.type === "array") s.items = { type: "string" };
  return s;
}

function paramToOpenApi(p: ApiParam): Record<string, unknown> {
  return {
    name: p.name,
    in: p.in,
    required: p.in === "path" ? true : p.required,
    schema: { type: p.type || "string" },
    ...(p.description ? { description: p.description } : {}),
  };
}

export function endpointToOperation(e: EndpointContract): Record<string, unknown> {
  const opId = `${e.method.toLowerCase()}_${e.path
    .replace(/[\/{}]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase()}`;
  const op: Record<string, unknown> = {
    summary: e.summary ?? `${e.method} ${e.path}`,
    operationId: opId,
    parameters: [...e.pathParams, ...e.queryParams].map(paramToOpenApi),
    responses: buildResponses(e),
  };
  if (e.description) op.description = e.description;
  if (e.requestBody && (e.requestBody.present || e.requestBody.fields.length)) {
    op.requestBody = {
      required: e.requestBody.fields.some((f) => f.required),
      content: {
        [e.requestBody.contentType || "application/json"]: {
          schema: fieldsToObjectSchema(e.requestBody.fields),
        },
      },
    };
  }
  if (e.auth.required) {
    op.security = [{ bearerAuth: [] }];
  }
  return op;
}

function fieldsToObjectSchema(fields: SchemaField[]): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: "object",
    properties: Object.fromEntries(fields.map((f) => [f.name, fieldToSchema(f)])),
  };
  const required = fields.filter((f) => f.required).map((f) => f.name);
  if (required.length) schema.required = required;
  return schema;
}

function buildResponses(e: EndpointContract): Record<string, unknown> {
  const list = e.responses.length
    ? e.responses
    : [{ status: "200", description: "Success", fields: [] as SchemaField[] }];
  const out: Record<string, unknown> = {};
  for (const r of list) {
    const entry: Record<string, unknown> = { description: r.description ?? "Response" };
    if (r.fields.length) {
      entry.content = {
        "application/json": { schema: fieldsToObjectSchema(r.fields) },
      };
    }
    out[r.status] = entry;
  }
  return out;
}

export interface PatchResult {
  doc: Record<string, unknown>;
  patched: string[];
  added: string[];
  removed: string[];
  skipped: { id: string; reason: string }[];
}

/**
 * Apply endpoint changes to a spec doc (mutates a clone).
 * - NEW_ENDPOINT -> add operation
 * - DELETED_ENDPOINT -> remove operation (only with allowDelete)
 * - schema/param/auth changes -> replace that operation
 */
export function patchSpec(
  baseDoc: Record<string, unknown>,
  endpointsAfter: EndpointContract[],
  opts: { idsToSync?: Set<string>; allowDelete?: boolean } = {}
): PatchResult {
  const doc = JSON.parse(JSON.stringify(baseDoc)) as Record<string, unknown>;
  if (!doc.openapi) doc.openapi = "3.0.3";
  if (!doc.info) {
    doc.info = { title: "API Sentinel synchronized API", version: "1.0.0" };
  }
  if (!doc.paths || typeof doc.paths !== "object") doc.paths = {};
  const paths = doc.paths as Record<string, unknown>;

  const patched: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  const want = (id: string) => !opts.idsToSync || opts.idsToSync.has(id);
  const afterIds = new Set(endpointsAfter.map((e) => e.id));

  // upsert operations for current endpoints
  for (const e of endpointsAfter) {
    const opKey = e.method.toLowerCase();
    const pathItem = (paths[e.path] as Record<string, unknown> | undefined) ?? {};
    const exists = !!pathItem[opKey];
    if (!want(e.id)) {
      skipped.push({ id: e.id, reason: "not selected for sync" });
      continue;
    }
    pathItem[opKey] = endpointToOperation(e);
    paths[e.path] = pathItem;
    if (exists) patched.push(e.id);
    else added.push(e.id);
  }

  // deletions: only operations that match a previously synced endpoint id
  // and are explicitly allowed (approval workflow sets allowDelete).
  if (opts.allowDelete) {
    for (const [path, item] of Object.entries(paths)) {
      const rec = item as Record<string, unknown>;
      for (const verb of ["get", "post", "put", "patch", "delete", "head", "options"]) {
        if (!rec[verb]) continue;
        const id = `${verb.toUpperCase()} ${path}`;
        if (!afterIds.has(id) && want(id)) {
          delete rec[verb];
          removed.push(id);
        }
      }
      if (Object.keys(rec).filter((k) => k !== "parameters").length === 0) {
        delete paths[path];
      }
    }
  }

  // ensure bearerAuth scheme exists if any op references it
  const needsAuth = JSON.stringify(paths).includes("bearerAuth");
  if (needsAuth) {
    const comps = (doc.components as Record<string, unknown> | undefined) ?? {};
    const schemes = (comps.securitySchemes as Record<string, unknown> | undefined) ?? {};
    if (!schemes.bearerAuth) {
      schemes.bearerAuth = { type: "http", scheme: "bearer", bearerFormat: "JWT" };
      comps.securitySchemes = schemes;
      doc.components = comps;
    }
  }

  return { doc, patched, added, removed, skipped };
}

/** Build a fresh minimal spec when the repo has no OpenAPI file. */
export function buildFreshSpec(
  title: string,
  endpoints: EndpointContract[]
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    openapi: "3.0.3",
    info: {
      title,
      version: "1.0.0",
      description: "Generated by API Sentinel from source analysis.",
    },
    paths: {},
  };
  return patchSpec(base, endpoints).doc;
}

/** Human-readable unified-ish patch preview for the approval workflow. */
export function previewPatch(
  beforeDoc: Record<string, unknown>,
  afterDoc: Record<string, unknown>,
  maxLines = 160
): string {
  const before = JSON.stringify(beforeDoc, null, 2).split("\n");
  const after = JSON.stringify(afterDoc, null, 2).split("\n");
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const out: string[] = [];
  for (const l of after) {
    if (!beforeSet.has(l)) out.push(`+ ${l}`);
    if (out.length >= maxLines) break;
  }
  for (const l of before) {
    if (!afterSet.has(l)) out.push(`- ${l}`);
    if (out.length >= maxLines) break;
  }
  if (!out.length) return "(no textual differences)";
  return out.slice(0, maxLines).join("\n");
}

export function specToYaml(doc: Record<string, unknown>): string {
  // Lazy JSON-first; YAML rendering happens in the docs UI via js-yaml dump.
  void parseSpec;
  return JSON.stringify(doc, null, 2);
}

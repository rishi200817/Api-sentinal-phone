/**
 * Deterministic API diff engine.
 * Compares normalized contracts (before vs after) and emits granular,
 * field-level changes. Pure + fully testable — no AI involved.
 */
import type {
  ApiChange,
  ApiParam,
  ChangeType,
  EndpointContract,
  FieldChange,
  SchemaField,
  Severity,
} from "../types";
import { classifyChange } from "../impact/risk";

function fieldMap(fields: SchemaField[]): Map<string, SchemaField> {
  return new Map(fields.map((f) => [f.name, f]));
}

function paramKey(p: ApiParam): string {
  return `${p.in}:${p.name}`;
}

function diffFields(
  before: SchemaField[],
  after: SchemaField[],
  location: string
): FieldChange[] {
  const out: FieldChange[] = [];
  const b = fieldMap(before);
  const a = fieldMap(after);
  for (const [name, bf] of b) {
    const af = a.get(name);
    if (!af) {
      out.push({
        kind: "field-removed",
        location,
        field: name,
        before: `${bf.type}${bf.required ? ", required" : ", optional"}`,
        breaking: "likely-breaking",
        note: `Field '${name}' was removed from ${location}.`,
      });
      continue;
    }
    if (bf.type !== af.type) {
      out.push({
        kind: "type-changed",
        location,
        field: name,
        before: bf.type,
        after: af.type,
        breaking: "likely-breaking",
        note: `Field '${name}' type changed ${bf.type} → ${af.type}.`,
      });
    }
    if (bf.required !== af.required) {
      out.push({
        kind: "required-changed",
        location,
        field: name,
        before: bf.required ? "required" : "optional",
        after: af.required ? "required" : "optional",
        breaking: af.required ? "potentially-breaking" : "non-breaking",
        note: `Field '${name}' is now ${af.required ? "required" : "optional"}.`,
      });
    }
    // recurse one level for nested objects
    if (bf.children?.length || af.children?.length) {
      out.push(
        ...diffFields(bf.children ?? [], af.children ?? [], `${location}.${name}`)
      );
    }
  }
  for (const [name, af] of a) {
    if (!b.has(name)) {
      out.push({
        kind: "field-added",
        location,
        field: name,
        after: `${af.type}${af.required ? ", required" : ", optional"}`,
        breaking: af.required ? "potentially-breaking" : "non-breaking",
        note: `Field '${name}' was added to ${location} (${af.required ? "required" : "optional"}).`,
      });
    }
  }
  return out;
}

function diffParams(
  before: ApiParam[],
  after: ApiParam[],
  location: string
): FieldChange[] {
  const out: FieldChange[] = [];
  const b = new Map(before.map((p) => [paramKey(p), p]));
  const a = new Map(after.map((p) => [paramKey(p), p]));
  for (const [k, bp] of b) {
    const ap = a.get(k);
    if (!ap) {
      out.push({
        kind: "param-removed",
        location,
        field: bp.name,
        before: `${bp.in}, ${bp.required ? "required" : "optional"}`,
        breaking: bp.required ? "likely-breaking" : "potentially-breaking",
        note: `${bp.in} parameter '${bp.name}' was removed.`,
      });
      continue;
    }
    if (bp.required !== ap.required || bp.type !== ap.type) {
      out.push({
        kind: "param-changed",
        location,
        field: bp.name,
        before: `${bp.type}, ${bp.required ? "required" : "optional"}`,
        after: `${ap.type}, ${ap.required ? "required" : "optional"}`,
        breaking:
          ap.required && !bp.required ? "potentially-breaking" : "non-breaking",
        note: `${bp.in} parameter '${bp.name}' changed.`,
      });
    }
  }
  for (const [k, ap] of a) {
    if (!b.has(k)) {
      out.push({
        kind: "param-added",
        location,
        field: ap.name,
        after: `${ap.in}, ${ap.required ? "required" : "optional"}`,
        breaking: ap.required ? "potentially-breaking" : "non-breaking",
        note: `${ap.in} parameter '${ap.name}' was added (${ap.required ? "required" : "optional"}).`,
      });
    }
  }
  return out;
}

function diffAuth(
  before: EndpointContract,
  after: EndpointContract
): FieldChange[] {
  if (
    before.auth.required === after.auth.required &&
    before.auth.schemes.join(",") === after.auth.schemes.join(",")
  ) {
    return [];
  }
  if (!before.auth.required && after.auth.required) {
    return [
      {
        kind: "auth-changed",
        location: "security",
        before: "no auth",
        after: after.auth.schemes.join(", ") || "auth required",
        breaking: "potentially-breaking",
        note: "Authentication is now required for this endpoint.",
      },
    ];
  }
  if (before.auth.required && !after.auth.required) {
    return [
      {
        kind: "auth-changed",
        location: "security",
        before: before.auth.schemes.join(", ") || "auth required",
        after: "no auth",
        breaking: "likely-breaking",
        note: "Authentication was REMOVED — security-sensitive, mandatory review.",
      },
    ];
  }
  return [
    {
      kind: "auth-changed",
      location: "security",
      before: before.auth.schemes.join(", "),
      after: after.auth.schemes.join(", "),
      breaking: "potentially-breaking",
      note: "Authentication scheme changed.",
    },
  ];
}

function summarize(change: Omit<ApiChange, "id" | "createdAt" | "synced">): string {
  const fcs = change.fieldChanges;
  if (change.type === "NEW_ENDPOINT") return `New endpoint ${change.method} ${change.path}`;
  if (change.type === "DELETED_ENDPOINT")
    return `Deleted endpoint ${change.method} ${change.path}`;
  if (change.type === "METHOD_CHANGED") return `HTTP method changed on ${change.path}`;
  const bits = fcs.slice(0, 3).map((f) => f.note);
  return `${change.method} ${change.path}: ${bits.join(" ")}${fcs.length > 3 ? ` (+${fcs.length - 3} more)` : ""}`;
}

function recommendationFor(type: ChangeType, breaking: string): string {
  switch (type) {
    case "NEW_ENDPOINT":
      return "Review the generated operation, then sync it to OpenAPI and publish docs.";
    case "DELETED_ENDPOINT":
      return "Confirm the endpoint is intentionally removed; keep it deprecated for one release if external clients exist.";
    case "REQUEST_SCHEMA_CHANGED":
      return breaking === "non-breaking"
        ? "Safe additive change — sync docs."
        : "Notify consumers and provide a migration path before enforcing required fields.";
    case "RESPONSE_SCHEMA_CHANGED":
      return "Removed/renamed response fields break readers — version or deprecate before removing.";
    case "PARAMETER_CHANGED":
      return "Update client SDKs/query builders and sync the parameter docs.";
    case "METHOD_CHANGED":
      return "Changing the HTTP method breaks all existing callers — prefer a new endpoint + deprecation.";
    case "AUTH_CHANGED":
      return "Auth changes are security-sensitive — require human review before syncing.";
    case "MODIFIED_ENDPOINT":
      return "Review the modification and sync docs.";
    default:
      return "No action needed.";
  }
}

let changeCounter = 0;

function makeChange(
  partial: Omit<ApiChange, "id" | "createdAt" | "synced" | "summary" | "recommendation" | "severity" | "breaking">
    & { severity?: Severity; breaking?: ApiChange["breaking"] }
): ApiChange {
  const draft = partial as Omit<ApiChange, "id" | "createdAt" | "synced" | "summary" | "recommendation">;
  const { severity, breaking } = classifyChange(draft.type, draft.fieldChanges);
  const full = {
    ...draft,
    severity: partial.severity ?? severity,
    breaking: partial.breaking ?? breaking,
  };
  changeCounter += 1;
  return {
    ...full,
    id: `chg_${Date.now().toString(36)}_${(changeCounter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    summary: "",
    recommendation: "",
    synced: false,
    createdAt: new Date().toISOString(),
  } as ApiChange;
}

function finalize(c: ApiChange): ApiChange {
  c.summary = summarize(c);
  c.recommendation = recommendationFor(c.type, c.breaking);
  return c;
}

export interface DiffOptions {
  /** correlate renames: match deleted+added by method+similarity — conservative */
  correlateMoves?: boolean;
}

/**
 * Compare two normalized contract sets.
 * Keyed by METHOD + path. Also detects method changes on the same path.
 */
export function diffContracts(
  before: EndpointContract[],
  after: EndpointContract[],
  opts: DiffOptions = {}
): ApiChange[] {
  void opts;
  const changes: ApiChange[] = [];
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const afterById = new Map(after.map((e) => [e.id, e]));
  const afterByPath = new Map<string, EndpointContract[]>();
  for (const e of after) {
    const list = afterByPath.get(e.path) ?? [];
    list.push(e);
    afterByPath.set(e.path, list);
  }

  const matchedAfter = new Set<string>();

  for (const b of before) {
    const a = afterById.get(b.id);
    if (a) {
      matchedAfter.add(a.id);
      changes.push(...diffEndpointPair(b, a));
      continue;
    }
    // method changed? same path, different method
    const samePath = (afterByPath.get(b.path) ?? []).filter((x) => !matchedAfter.has(x.id));
    if (samePath.length === 1) {
      const na = samePath[0];
      matchedAfter.add(na.id);
      changes.push(
        finalize(
          makeChange({
            type: "METHOD_CHANGED",
            method: na.method,
            path: na.path,
            detail: `HTTP method changed ${b.method} → ${na.method} on ${b.path}.`,
            fieldChanges: [
              {
                kind: "method-changed",
                location: "method",
                before: b.method,
                after: na.method,
                breaking: "likely-breaking",
                note: `Method changed ${b.method} → ${na.method}.`,
              },
            ],
            before: b,
            after: na,
            evidence: [`${na.sourceFile}:${na.sourceLine}`],
          })
        )
      );
      // also diff the pair for schema drift
      changes.push(...diffEndpointPair(b, na, true));
      continue;
    }
    changes.push(
      finalize(
        makeChange({
          type: "DELETED_ENDPOINT",
          method: b.method,
          path: b.path,
          detail: `Endpoint ${b.method} ${b.path} no longer exists in source (was ${b.sourceFile}:${b.sourceLine}).`,
          fieldChanges: [],
          before: b,
          after: null,
          evidence: [`previously ${b.sourceFile}:${b.sourceLine}`],
        })
      )
    );
  }

  for (const a of after) {
    if (matchedAfter.has(a.id)) continue;
    // skip ones already consumed as method-change targets
    if (before.some((b) => b.path === a.path && b.method !== a.method && !afterById.has(b.id))) {
      // handled above as METHOD_CHANGED (single candidate case); otherwise it's genuinely new
      const samePathBefore = before.filter((b) => b.path === a.path);
      if (samePathBefore.length === 1 && !afterById.has(samePathBefore[0].id)) continue;
    }
    changes.push(
      finalize(
        makeChange({
          type: "NEW_ENDPOINT",
          method: a.method,
          path: a.path,
          detail: `New endpoint ${a.method} ${a.path} found at ${a.sourceFile}:${a.sourceLine}.`,
          fieldChanges: [],
          before: null,
          after: a,
          evidence: [`${a.sourceFile}:${a.sourceLine}`],
        })
      )
    );
  }

  // severity ordering: CRITICAL > HIGH > MEDIUM > LOW
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  changes.sort((x, y) => order[x.severity] - order[y.severity]);
  return changes;
}

function evidenceFor(b: EndpointContract, a: EndpointContract): string[] {
  const ev = [`${a.sourceFile}:${a.sourceLine}`];
  if (b.sourceFile !== a.sourceFile) ev.push(`was ${b.sourceFile}:${b.sourceLine}`);
  return ev;
}

/** Diff a matched before/after endpoint pair into granular changes. */
export function diffEndpointPair(
  b: EndpointContract,
  a: EndpointContract,
  _methodChanged = false
): ApiChange[] {
  void _methodChanged;
  const out: ApiChange[] = [];

  // request body
  const reqChanges = diffFields(
    b.requestBody?.fields ?? [],
    a.requestBody?.fields ?? [],
    "requestBody"
  );
  if (reqChanges.length) {
    out.push(
      finalize(
        makeChange({
          type: "REQUEST_SCHEMA_CHANGED",
          method: a.method,
          path: a.path,
          detail: `Request schema changed on ${a.method} ${a.path}: ${reqChanges.map((f) => f.note).join(" ")}`,
          fieldChanges: reqChanges,
          before: b,
          after: a,
          evidence: evidenceFor(b, a),
        })
      )
    );
  }

  // responses (compare per status, then union)
  const bResp = new Map(b.responses.map((r) => [r.status, r]));
  const aResp = new Map(a.responses.map((r) => [r.status, r]));
  const respChanges: FieldChange[] = [];
  for (const [status, br] of bResp) {
    const ar = aResp.get(status);
    if (!ar) {
      respChanges.push({
        kind: "status-removed",
        location: `responses.${status}`,
        before: status,
        breaking: "potentially-breaking",
        note: `Response status ${status} no longer documented/returned.`,
      });
      continue;
    }
    respChanges.push(...diffFields(br.fields, ar.fields, `responses.${status}`));
  }
  for (const [status] of aResp) {
    if (!bResp.has(status)) {
      respChanges.push({
        kind: "status-added",
        location: `responses.${status}`,
        after: status,
        breaking: "non-breaking",
        note: `New response status ${status}.`,
      });
    }
  }
  if (respChanges.length) {
    out.push(
      finalize(
        makeChange({
          type: "RESPONSE_SCHEMA_CHANGED",
          method: a.method,
          path: a.path,
          detail: `Response schema changed on ${a.method} ${a.path}: ${respChanges.map((f) => f.note).join(" ")}`,
          fieldChanges: respChanges,
          before: b,
          after: a,
          evidence: evidenceFor(b, a),
        })
      )
    );
  }

  // params
  const paramChanges = [
    ...diffParams(b.pathParams, a.pathParams, "pathParams"),
    ...diffParams(b.queryParams, a.queryParams, "queryParams"),
  ];
  if (paramChanges.length) {
    out.push(
      finalize(
        makeChange({
          type: "PARAMETER_CHANGED",
          method: a.method,
          path: a.path,
          detail: `Parameters changed on ${a.method} ${a.path}: ${paramChanges.map((f) => f.note).join(" ")}`,
          fieldChanges: paramChanges,
          before: b,
          after: a,
          evidence: evidenceFor(b, a),
        })
      )
    );
  }

  // auth
  const authChanges = diffAuth(b, a);
  if (authChanges.length) {
    out.push(
      finalize(
        makeChange({
          type: "AUTH_CHANGED",
          method: a.method,
          path: a.path,
          detail: authChanges.map((f) => f.note).join(" "),
          fieldChanges: authChanges,
          before: b,
          after: a,
          evidence: evidenceFor(b, a),
        })
      )
    );
  }

  return out;
}

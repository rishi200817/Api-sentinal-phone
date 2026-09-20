/**
 * OpenAPI validation: custom Sentinel structural checks + a
 * standards-compliant validation library (@apidevtools/swagger-parser).
 * Invalid specs are always rejected with exact errors.
 */
import SwaggerParser from "@apidevtools/swagger-parser";
import type { ValidationIssue, ValidationResult } from "../types";

const VERBS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];

function structuralCheck(doc: Record<string, unknown>, strict: boolean): {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
} {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (typeof doc.openapi !== "string" || !/^3\.\d+\.\d+$/.test(doc.openapi)) {
    errors.push({
      path: "openapi",
      message: `openapi must be a 3.x version string (got ${JSON.stringify(doc.openapi)}).`,
      severity: "error",
    });
  }
  const info = doc.info as Record<string, unknown> | undefined;
  if (!info || typeof info.title !== "string" || typeof info.version !== "string") {
    errors.push({
      path: "info",
      message: "info.title and info.version are required.",
      severity: "error",
    });
  }
  const paths = doc.paths as Record<string, unknown> | undefined;
  if (!paths || typeof paths !== "object") {
    errors.push({ path: "paths", message: "paths object is required.", severity: "error" });
    return { errors, warnings };
  }
  let opCount = 0;
  for (const [path, item] of Object.entries(paths)) {
    if (!path.startsWith("/")) {
      errors.push({ path: `paths.${path}`, message: "Path must start with '/'.", severity: "error" });
    }
    const rec = item as Record<string, unknown>;
    if (!rec || typeof rec !== "object") {
      errors.push({ path: `paths.${path}`, message: "Path item must be an object.", severity: "error" });
      continue;
    }
    const declaredPathParams = new Set(
      [...(path.matchAll(/\{([^}]+)\}/g))].map((m) => m[1])
    );
    for (const verb of VERBS) {
      const op = rec[verb] as Record<string, unknown> | undefined;
      if (!op) continue;
      opCount++;
      const base = `paths.${path}.${verb}`;
      if (!op.responses || typeof op.responses !== "object") {
        errors.push({ path: `${base}.responses`, message: "responses object is required.", severity: "error" });
      } else {
        for (const [code, resp] of Object.entries(op.responses as Record<string, unknown>)) {
          if (!/^(\d{3}|default)$/.test(code)) {
            warnings.push({ path: `${base}.responses.${code}`, message: `Unusual status key '${code}'.`, severity: "warning" });
          }
          const r = resp as Record<string, unknown>;
          if (!r || typeof r.description !== "string") {
            errors.push({ path: `${base}.responses.${code}`, message: "Response must include a description.", severity: "error" });
          }
        }
      }
      // params: path params must be required + declared in template
      const params = Array.isArray(op.parameters) ? op.parameters : [];
      const seen = new Set<string>();
      for (const p of params as Record<string, unknown>[]) {
        if (!p || typeof p.name !== "string" || typeof p.in !== "string") {
          errors.push({ path: `${base}.parameters`, message: "Parameter needs name + in.", severity: "error" });
          continue;
        }
        const k = `${p.in}:${p.name}`;
        if (seen.has(k)) {
          errors.push({ path: `${base}.parameters`, message: `Duplicate parameter '${k}'.`, severity: "error" });
        }
        seen.add(k);
        if (p.in === "path" && p.required !== true) {
          errors.push({ path: `${base}.parameters.${p.name}`, message: "Path parameters must have required: true.", severity: "error" });
        }
      }
      for (const pp of declaredPathParams) {
        if (![...seen].some((s) => s === `path:${pp}`)) {
          errors.push({ path: base, message: `Path template '{${pp}}' has no matching path parameter.`, severity: "error" });
        }
      }
      if (strict && typeof op.summary !== "string") {
        warnings.push({ path: base, message: "Missing summary (strict mode).", severity: "warning" });
      }
    }
  }
  if (opCount === 0) {
    warnings.push({ path: "paths", message: "Specification contains zero operations.", severity: "warning" });
  }
  return { errors, warnings };
}

export async function validateSpec(
  doc: Record<string, unknown>,
  opts: { strict?: boolean } = {}
): Promise<ValidationResult> {
  const t0 = Date.now();
  const engines: string[] = ["sentinel-structural"];
  const { errors, warnings } = structuralCheck(doc, opts.strict ?? false);

  // Standards-compliant library validation (dereference + JSON-schema check).
  try {
    await SwaggerParser.validate(JSON.parse(JSON.stringify(doc)) as never);
    engines.push("@apidevtools/swagger-parser");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // swagger-parser throws on the first problem; surface it exactly.
    const details = message.split("\n").slice(0, 6).join(" ");
    errors.push({
      path: "(spec)",
      message: `Standards validation failed: ${details}`,
      severity: "error",
    });
  }

  let operations = 0;
  try {
    const paths = (doc.paths ?? {}) as Record<string, unknown>;
    for (const item of Object.values(paths)) {
      const rec = item as Record<string, unknown>;
      for (const v of VERBS) if (rec?.[v]) operations++;
    }
  } catch {
    /* ignore */
  }

  return {
    valid: errors.length === 0,
    specVersion: typeof doc.openapi === "string" ? doc.openapi : undefined,
    operations,
    errors: errors.slice(0, 50),
    warnings: warnings.slice(0, 50),
    engine: engines,
    durationMs: Date.now() - t0,
  };
}

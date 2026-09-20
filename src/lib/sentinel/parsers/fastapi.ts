/**
 * FastAPI / Python route extractor.
 * Supports path params, Query/Body, Pydantic models, response_model,
 * status codes, router prefixes, and dependency-based auth hints.
 */
import type {
  ApiParam,
  EndpointContract,
  ResponseShape,
  SchemaField,
} from "../types";
import {
  endpointId,
  joinPaths,
  lineOf,
  looksLikeAuthMiddleware,
  mapPyType,
  normalizePath,
  readBalanced,
  splitTopLevelArgs,
} from "./util";

export interface PydanticModel {
  name: string;
  file: string;
  fields: SchemaField[];
}

export interface RouterInfo {
  varName: string;
  file: string;
  prefix: string;
}

export function parsePydanticModels(file: string, text: string): PydanticModel[] {
  // Pass 1: collect every class with its bases + fields.
  const classes: { name: string; bases: string[]; fields: SchemaField[] }[] = [];
  const classRe = /class\s+(\w+)\s*\(([^)]*)\)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(text))) {
    const name = m[1];
    const bases = m[2].split(",").map((b) => b.trim().split(".").pop()!).filter(Boolean);
    const startLine = lineOf(text, m.index);
    const lines = text.split("\n");
    const fields: SchemaField[] = [];
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent === 0 && line.trim() !== "") break; // next top-level block
      if (indent === 0) continue;
      // nested class/function ends field list
      if (/^\s*(class|def|@)\b/.test(line)) {
        if (/^\s*class\b/.test(line)) break;
        continue;
      }
      // field: name: Type = default / Field(...)
      const fm = line.trim().match(/^(\w+)\s*:\s*([^=:#]+)(?:=\s*(.+))?$/);
      if (!fm) continue;
      const fname = fm[1];
      if (fname.startsWith("_")) continue;
      const ftype = fm[2].trim();
      const def = (fm[3] ?? "").trim();
      const optional = /Optional\[|Union\[.*None|None\s*\||\|\s*None/.test(ftype);
      const hasDefault = def !== "" && !/^Field\(\s*\.\.\./.test(def);
      fields.push({
        name: fname,
        type: mapPyType(ftype),
        required: !optional && !hasDefault,
        description: def.includes("description=") ? def.slice(0, 140) : undefined,
        origin: `Pydantic ${name}`,
        confidence: "detected",
      });
    }
    classes.push({ name, bases, fields });
  }
  // Pass 2: keep BaseModel-rooted classes, inheriting parent fields.
  const byName = new Map(classes.map((c) => [c.name, c]));
  const isModel = (c: { name: string; bases: string[] }, depth = 0): boolean => {
    if (depth > 6) return false;
    if (c.bases.includes("BaseModel")) return true;
    return c.bases.some((b) => {
      const p = byName.get(b);
      return p ? isModel(p, depth + 1) : false;
    });
  };
  const mergedFields = (
    c: { name: string; bases: string[]; fields: SchemaField[] },
    depth = 0
  ): SchemaField[] => {
    if (depth > 6) return [...c.fields];
    const acc = new Map<string, SchemaField>();
    for (const b of c.bases) {
      const p = byName.get(b);
      if (p && isModel(p)) {
        for (const f of mergedFields(p, depth + 1)) {
          if (!acc.has(f.name)) acc.set(f.name, f);
        }
      }
    }
    for (const f of c.fields) acc.set(f.name, f);
    return [...acc.values()];
  };
  const out: PydanticModel[] = [];
  for (const c of classes) {
    if (isModel(c)) out.push({ name: c.name, file, fields: mergedFields(c) });
  }
  return out;
}

export function parseRouterPrefixes(file: string, text: string): RouterInfo[] {
  const out: RouterInfo[] = [];
  const re = /(\w+)\s*=\s*APIRouter\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const openIdx = m.index + m[0].length - 1;
    const bal = readBalanced(text, openIdx);
    let prefix = "";
    if (bal) {
      const pm = bal.inner.match(/prefix\s*=\s*['"]([^'"]+)['"]/);
      if (pm) prefix = pm[1];
    }
    out.push({ varName: m[1], file, prefix });
  }
  return out;
}

export function parseIncludeRouters(
  file: string,
  text: string
): { file: string; expr: string; prefix: string }[] {
  const out: { file: string; expr: string; prefix: string }[] = [];
  const re = /\.include_router\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const openIdx = m.index + m[0].length - 1;
    const bal = readBalanced(text, openIdx);
    if (!bal) continue;
    const args = splitTopLevelArgs(bal.inner);
    if (!args.length) continue;
    // full dotted expression, e.g. `router` or `users.router`
    const expr = args[0].trim().match(/^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/)?.[1];
    if (!expr) continue;
    const pm = bal.inner.match(/prefix\s*=\s*['"]([^'"]+)['"]/);
    out.push({ file, expr, prefix: pm ? pm[1] : "" });
  }
  return out;
}

function dirOf(file: string): string {
  const i = file.lastIndexOf("/");
  return i >= 0 ? file.slice(0, i) : "";
}

/**
 * Resolve `import` / `from...import` aliases to .py files so that
 * `app.include_router(users.router)` can be traced to the defining module.
 */
export function buildPyImportMap(
  file: string,
  text: string,
  files: Map<string, string>
): Map<string, string> {
  const out = new Map<string, string>();
  const dir = dirOf(file);
  const has = (p: string) => files.has(p);

  const resolveModule = (mod: string): string | null => {
    // relative: leading dots climb from the importing file's dir
    let rel = mod;
    let base = dir;
    const dots = mod.match(/^\.+/)?.[0].length ?? 0;
    if (dots > 0) {
      rel = mod.slice(dots);
      const parts = base.split("/").filter(Boolean);
      for (let i = 1; i < dots; i++) parts.pop();
      base = parts.join("/");
    } else {
      base = "";
    }
    const modPath = rel.replace(/\./g, "/");
    const full = base ? `${base}/${modPath}` : modPath;
    const cands = [`${full}.py`, `${full}/__init__.py`];
    for (const c of cands) {
      if (has(c)) return c;
    }
    return null;
  };

  // from X import a, b as c
  for (const m of text.matchAll(/^\s*from\s+(\.+\w[\w.]*|\w[\w.]*)\s+import\s+([^#\n]+)/gm)) {
    const mod = m[1];
    const names = m[2].replace(/[()]/g, " ");
    for (const part of names.split(",")) {
      const nm = part.trim().match(/^(?:(\w+)\s+as\s+)?(\w+)$/);
      if (!nm) continue;
      const imported = nm[1] ?? nm[2];
      const alias = nm[2];
      // submodule file wins: `from app.routers import auth` -> app/routers/auth.py
      const sub = resolveModule(mod ? `${mod}.${imported}` : imported);
      if (sub) {
        out.set(alias, sub);
        continue;
      }
      // attribute of a module file: `from app.routers.items import router`
      const modFile = resolveModule(mod);
      if (modFile) out.set(alias, modFile);
    }
  }
  // import a.b / import a.b as c  (alias defaults to first segment)
  for (const m of text.matchAll(/^\s*import\s+([^#\n]+)/gm)) {
    for (const part of m[1].split(",")) {
      const nm = part.trim().match(/^(\.+)?([\w.]+)(?:\s+as\s+(\w+))?$/);
      if (!nm) continue;
      const f = resolveModule(`${nm[1] ?? ""}${nm[2]}`);
      if (f) out.set(nm[3] ?? nm[2].split(".")[0], f);
    }
  }
  return out;
}

/** Resolve an include_router() expression to the defining (file, router var). */
function resolveIncludeTarget(
  inc: { file: string; expr: string },
  importMaps: Map<string, Map<string, string>>
): { file: string; router: string } {
  const segs = inc.expr.split(".");
  if (segs.length === 1) return { file: inc.file, router: segs[0] };
  const alias = segs[0];
  const attr = segs[segs.length - 1];
  const target = importMaps.get(inc.file)?.get(alias);
  if (target) return { file: target, router: attr };
  // fallback: same-file attribute (e.g. `self.router` style or local module var)
  return { file: inc.file, router: attr };
}

export interface RouteDecorator {
  hostVar: string;
  method: string;
  path: string;
  line: number;
  kwargs: string;
  funcName: string;
  signature: string;
  funcLine: number;
  docstring: string | null;
}

export function parseDecorators(file: string, text: string): RouteDecorator[] {
  void file;
  const out: RouteDecorator[] = [];
  const re = /@(\w+)\.(get|post|put|patch|delete|options|head)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const hostVar = m[1];
    const method = m[2].toUpperCase();
    const openIdx = m.index + m[0].length - 1;
    const bal = readBalanced(text, openIdx);
    if (!bal) continue;
    const args = splitTopLevelArgs(bal.inner);
    const pathM = args[0]?.match(/^\s*['"]([^'"]+)['"]/) ?? null;
    if (!pathM) continue;
    // find the def line after the decorator
    const after = text.slice(bal.end);
    const defM = after.match(/^\s*(?:@[\w.]+\s*(?:\([^)]*\))?\s*)*(?:async\s+)?def\s+(\w+)\s*\(/m);
    if (!defM || defM.index === undefined) continue;
    const defAbsIdx = bal.end + defM.index + defM[0].lastIndexOf("(");
    const sigBal = readBalanced(text, defAbsIdx);
    const signature = sigBal ? sigBal.inner : "";
    // docstring: first string literal in body
    let docstring: string | null = null;
    if (sigBal) {
      const bodyStart = text.slice(sigBal.end, sigBal.end + 600);
      const ds = bodyStart.match(/:\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"([^"\n]*)"|'([^'\n]*)')/);
      if (ds) docstring = (ds[1] ?? ds[2] ?? ds[3] ?? ds[4] ?? "").trim().slice(0, 300) || null;
    }
    out.push({
      hostVar,
      method,
      path: pathM[1],
      line: lineOf(text, m.index),
      kwargs: bal.inner,
      funcName: defM[1],
      signature,
      funcLine: lineOf(text, defAbsIdx),
      docstring,
    });
  }
  return out;
}

export function parseSignatureParams(
  signature: string,
  models: Map<string, PydanticModel>,
  routePath: string
): {
  pathParams: ApiParam[];
  queryParams: ApiParam[];
  bodyModel: string | null;
  bodyFields: SchemaField[];
  auth: { required: boolean; via: string[] };
} {
  const pathParams: ApiParam[] = [];
  const queryParams: ApiParam[] = [];
  let bodyModel: string | null = null;
  const bodyFields: SchemaField[] = [];
  const authVia: string[] = [];

  const pathNames = new Set(
    [...routePath.matchAll(/\{(\w+)\}/g)].map((x) => x[1])
  );
  const params = splitTopLevelArgs(signature);
  for (const p of params) {
    const pm = p.trim().match(/^(\w+)(?:\s*:\s*([^=]+?))?(?:=\s*(.+))?$/s);
    if (!pm) continue;
    const name = pm[1];
    const ann = (pm[2] ?? "").trim();
    const def = (pm[3] ?? "").trim();
    if (name === "self" || name === "cls") continue;

    // Depends / Security -> auth or injected dep
    const depM = def.match(/^(?:Security|Depends)\s*\((.*)\)$/s);
    if (depM) {
      const inner = depM[1];
      if (looksLikeAuthMiddleware(inner) || /current_user|get_current|oauth2|token/i.test(inner)) {
        authVia.push(`${name} via ${def.slice(0, 60)}`);
      }
      continue;
    }
    // Body(...) explicit
    if (/^Body\s*\(/.test(def)) {
      bodyFields.push({
        name,
        type: mapPyType(ann),
        required: true,
        origin: "Body()",
        confidence: "detected",
      });
      continue;
    }
    // Query(...) explicit
    if (/^Query\s*\(/.test(def)) {
      const required = /\.\.\./.test(def);
      queryParams.push({
        name,
        in: "query",
        required,
        type: mapPyType(ann),
        origin: "Query()",
        confidence: "detected",
      });
      continue;
    }
    // Path(...) explicit
    if (/^Path\s*\(/.test(def)) {
      pathParams.push({
        name,
        in: "path",
        required: true,
        type: mapPyType(ann),
        origin: "Path()",
        confidence: "detected",
      });
      continue;
    }
    // Pydantic model annotation -> request body
    const baseAnn = ann.replace(/^(Optional|Union|List|list|Annotated)\s*\[/, "").replace(/[\[\],].*$/, "").trim();
    if (models.has(baseAnn) || models.has(ann)) {
      bodyModel = models.has(ann) ? ann : baseAnn;
      continue;
    }
    if (pathNames.has(name)) {
      pathParams.push({
        name,
        in: "path",
        required: true,
        type: mapPyType(ann),
        origin: "path template",
        confidence: "detected",
      });
      continue;
    }
    // Scalar with default -> query; scalar without default on GET -> query required
    if (/^(str|int|float|bool|StrictStr|StrictInt)/.test(baseAnn) || def !== "") {
      const optional = /Optional\[|None/.test(ann);
      queryParams.push({
        name,
        in: "query",
        required: def === "" && !optional,
        type: mapPyType(ann),
        origin: def ? "default-valued param" : "signature param",
        confidence: "inferred",
      });
      continue;
    }
    // Unknown complex annotation -> treat as body-ish unknown model reference
    if (/^[A-Z]\w*$/.test(baseAnn)) {
      bodyModel = baseAnn; // unresolved model; fields unknown
      continue;
    }
  }
  return { pathParams, queryParams, bodyModel, bodyFields, auth: { required: authVia.length > 0, via: authVia } };
}

export interface FastApiFileModel {
  file: string;
  models: PydanticModel[];
  routers: RouterInfo[];
  includes: { file: string; expr: string; prefix: string }[];
  decorators: RouteDecorator[];
}

export function buildFastApiFileModel(file: string, text: string): FastApiFileModel {
  return {
    file,
    models: parsePydanticModels(file, text),
    routers: parseRouterPrefixes(file, text),
    includes: parseIncludeRouters(file, text),
    decorators: parseDecorators(file, text),
  };
}

export function parseFastApiFiles(files: Map<string, string>): {
  endpoints: EndpointContract[];
} {
  const pyFiles = [...files.entries()].filter(([f]) => f.endsWith(".py"));
  const perFile = new Map<string, FastApiFileModel>();
  for (const [file, text] of pyFiles) {
    perFile.set(file, buildFastApiFileModel(file, text));
  }
  return { endpoints: assembleFastApiEndpoints(perFile, files) };
}

/** Assemble endpoints from merged per-file models (cheap; rerun after incremental merge). */
export function assembleFastApiEndpoints(
  perFile: Map<string, FastApiFileModel>,
  files: Map<string, string>
): EndpointContract[] {
  const models = new Map<string, PydanticModel>();
  const routers: RouterInfo[] = [];
  const importMaps = new Map<string, Map<string, string>>();
  const rawIncludes: { file: string; expr: string; prefix: string }[] = [];

  for (const [file, fm] of perFile) {
    for (const m of fm.models) {
      if (!models.has(m.name)) models.set(m.name, m);
    }
    routers.push(...fm.routers);
    rawIncludes.push(...fm.includes);
    importMaps.set(file, buildPyImportMap(file, files.get(file) ?? "", files));
  }
  const includes = rawIncludes.map((inc) => ({
    ...resolveIncludeTarget(inc, importMaps),
    prefix: inc.prefix,
  }));

  const prefixOf = (hostVar: string, file: string): string => {
    const r = routers.find((x) => x.varName === hostVar && x.file === file);
    if (!r) return ""; // app-level
    const inc = includes.find((x) => x.router === hostVar && x.file === file);
    return joinPaths(inc?.prefix ?? "", r.prefix ?? "");
  };

  const endpoints: EndpointContract[] = [];
  for (const [file, fm] of perFile) {
    const text = files.get(file) ?? "";
    // skip files whose decorators are clearly not FastAPI (e.g. flask app.route?)
    for (const d of fm.decorators) {
      const isRouter = routers.some((r) => r.varName === d.hostVar);
      const looksLikeApp =
        /^(app|application|api)$/i.test(d.hostVar) ||
        new RegExp(`\\b${d.hostVar}\\s*=\\s*FastAPI\\s*\\(`).test(text);
      if (!isRouter && !looksLikeApp) continue;

      const fullPath = normalizePath(joinPaths(prefixOf(d.hostVar, file), d.path));
      const sig = parseSignatureParams(d.signature, models, d.path);

      // decorator-level auth: dependencies=[Depends(...)]
      const depAuth = [...d.kwargs.matchAll(/Depends\s*\(([^)]*)\)/g)].some((x) =>
        looksLikeAuthMiddleware(x[1])
      );
      const authRequired = sig.auth.required || depAuth;

      // body fields from model
      let bodyFields = sig.bodyFields;
      let bodyOrigin = "Body() params";
      let bodyConfidence: "detected" | "inferred" = "detected";
      if (sig.bodyModel && models.has(sig.bodyModel)) {
        bodyFields = models.get(sig.bodyModel)!.fields;
        bodyOrigin = `Pydantic ${sig.bodyModel}`;
      } else if (sig.bodyModel && !models.has(sig.bodyModel)) {
        bodyOrigin = `Unresolved model ${sig.bodyModel} (fields unknown)`;
        bodyConfidence = "inferred";
      }
      const wantsBody = ["POST", "PUT", "PATCH"].includes(d.method);

      // response_model
      const respModelM = d.kwargs.match(/response_model\s*=\s*(\w+)/);
      const statusM = d.kwargs.match(/status_code\s*=\s*(\d{3})/);
      const defaultStatus = statusM
        ? statusM[1]
        : d.method === "POST"
          ? "201"
          : "200";
      const responses: ResponseShape[] = [];
      if (respModelM && models.has(respModelM[1])) {
        responses.push({
          status: defaultStatus,
          description: "Success",
          fields: models.get(respModelM[1])!.fields,
          origin: `response_model ${respModelM[1]}`,
          confidence: "detected",
        });
      } else {
        responses.push({
          status: defaultStatus,
          description: "Success",
          fields: [],
          origin: respModelM
            ? `unresolved response_model ${respModelM[1]}`
            : "status default",
          confidence: respModelM ? "inferred" : "inferred",
        });
      }

      const summaryM = d.kwargs.match(/summary\s*=\s*['"]([^'"]+)['"]/);
      const descM = d.kwargs.match(/description\s*=\s*['"]([^'"]+)['"]/);
      const summary =
        summaryM?.[1] ?? d.docstring?.split("\n")[0] ?? `${d.method} ${fullPath}`;

      endpoints.push({
        id: endpointId(d.method, fullPath),
        method: d.method as EndpointContract["method"],
        path: fullPath,
        controller: d.funcName,
        sourceFile: file,
        sourceLine: d.line,
        framework: "fastapi",
        pathParams: sig.pathParams,
        queryParams: sig.queryParams,
        requestBody:
          bodyFields.length > 0 || wantsBody
            ? {
                contentType: "application/json",
                fields: bodyFields,
                present: bodyFields.length > 0,
                origin: bodyOrigin,
                confidence: bodyConfidence,
              }
            : undefined,
        responses,
        auth: authRequired
          ? {
              required: true,
              schemes: sig.auth.via.slice(0, 3),
              description: `Protected by dependency: ${sig.auth.via.slice(0, 2).join("; ") || "dependencies=[...]"}`,
              origin: "FastAPI dependencies",
              confidence: "inferred",
            }
          : {
              required: false,
              schemes: [],
              description: "No auth dependency observed",
              origin: "signature scan",
              confidence: "inferred",
            },
        summary: summary.slice(0, 140),
        description: descM?.[1] ?? d.docstring ?? undefined,
        confidence: "detected",
      });
    }
  }
  return endpoints;
}

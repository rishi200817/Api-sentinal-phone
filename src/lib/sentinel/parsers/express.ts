/**
 * Express / Node.js route extractor.
 * Static analysis only — never executes repository code.
 * Handles nested routers, prefixes, route params, middleware auth hints,
 * and same-file handler inference (req.body / req.query / res.status).
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
  mapTsType,
  normalizePath,
  readBalanced,
  splitTopLevelArgs,
} from "./util";

interface RawRoute {
  hostVar: string;
  method: string;
  path: string;
  line: number;
  middlewares: string[];
  handlerBody: string | null;
  handlerName: string | null;
  comment: string | null;
}

interface MountEdge {
  fromFile: string;
  fromVar: string;
  prefix: string;
  toFile: string;
  toVar: string;
}

export interface FileModel {
  file: string;
  dir: string;
  appVars: Set<string>;
  routerVars: Set<string>;
  imports: Map<string, string>; // local name -> resolved file
  namedImports: Map<string, { file: string; exported: string }>;
  exportedRouters: Set<string>; // local router names that are exported
  defaultExport: string | null;
  mounts: { parent: string; prefix: string; child: string; line: number }[];
  routes: RawRoute[];
  functions: Map<string, string>; // same-file handler bodies
}

/** JSON-serializable FileModel for the incremental parse cache. */
export interface SerializedFileModel {
  file: string;
  dir: string;
  appVars: string[];
  routerVars: string[];
  imports: [string, string][];
  namedImports: [string, { file: string; exported: string }][];
  exportedRouters: string[];
  defaultExport: string | null;
  mounts: { parent: string; prefix: string; child: string; line: number }[];
  routes: RawRoute[];
}

export function serializeFileModel(m: FileModel): SerializedFileModel {
  return {
    file: m.file,
    dir: m.dir,
    appVars: [...m.appVars],
    routerVars: [...m.routerVars],
    imports: [...m.imports.entries()],
    namedImports: [...m.namedImports.entries()],
    exportedRouters: [...m.exportedRouters],
    defaultExport: m.defaultExport,
    mounts: m.mounts,
    routes: m.routes,
  };
}

export function deserializeFileModel(s: SerializedFileModel): FileModel {
  return {
    file: s.file,
    dir: s.dir,
    appVars: new Set(s.appVars),
    routerVars: new Set(s.routerVars),
    imports: new Map(s.imports),
    namedImports: new Map(s.namedImports),
    exportedRouters: new Set(s.exportedRouters),
    defaultExport: s.defaultExport,
    mounts: s.mounts,
    routes: s.routes,
    functions: new Map(),
  };
}

const ROUTE_VERBS = ["get", "post", "put", "patch", "delete", "options", "head"];

function resolveRelative(fromDir: string, spec: string, files: Map<string, string>): string | null {
  if (!spec.startsWith(".")) return null;
  const base = fromDir ? `${fromDir}/${spec}` : spec;
  const norm = base.split("/").reduce<string[]>((acc, p) => {
    if (p === "" || p === ".") return acc;
    if (p === "..") acc.pop();
    else acc.push(p);
    return acc;
  }, []).join("/");
  const candidates = [
    norm,
    `${norm}.ts`,
    `${norm}.tsx`,
    `${norm}.js`,
    `${norm}.jsx`,
    `${norm}.mjs`,
    `${norm}.cjs`,
    `${norm}/index.ts`,
    `${norm}/index.js`,
  ];
  for (const c of candidates) {
    if (files.has(c)) return c;
  }
  return null;
}

function dirOf(file: string): string {
  const i = file.lastIndexOf("/");
  return i >= 0 ? file.slice(0, i) : "";
}

function stringLiteral(arg: string): string | null {
  const m = arg.match(/^['"`](.*)['"`]$/s);
  return m ? m[1] : null;
}

function identifierOf(arg: string): string | null {
  const m = arg.trim().match(/^([A-Za-z_$][\w$]*)$/);
  return m ? m[1] : null;
}

function isInlineHandler(arg: string): boolean {
  const t = arg.trim();
  return (
    t.includes("=>") ||
    /^(async\s+)?function\b/.test(t)
  );
}

function extractHandlerBody(arg: string): string | null {
  const t = arg.trim();
  const arrow = t.indexOf("=>");
  if (arrow >= 0) {
    const after = t.slice(arrow + 2).trim();
    if (after.startsWith("{")) {
      const bal = readBalanced(after, 0, "{", "}");
      return bal ? bal.inner : after;
    }
    return after;
  }
  const fn = t.match(/function[^(]*\([^)]*\)\s*\{/);
  if (fn && t.endsWith("}")) {
    return t.slice(t.indexOf("{") + 1, t.lastIndexOf("}"));
  }
  return null;
}

function precedingComment(lines: string[], lineIdx0: number): string | null {
  // lineIdx0: 0-based index of the route line
  const out: string[] = [];
  for (let i = lineIdx0 - 1; i >= Math.max(0, lineIdx0 - 6); i--) {
    const l = lines[i].trim();
    if (l.startsWith("//")) {
      out.unshift(l.replace(/^\/\/\s?/, ""));
    } else if (l.startsWith("*") || l.startsWith("/**") || l.startsWith("/*")) {
      const cleaned = l
        .replace(/^\/\*\*?/, "")
        .replace(/^\*\s?/, "")
        .replace(/\*\/$/, "")
        .trim();
      if (cleaned) out.unshift(cleaned);
      if (l.startsWith("/**") || l.startsWith("/*")) break;
    } else if (l === "") {
      continue;
    } else {
      break;
    }
  }
  return out.length ? out.join(" ").slice(0, 300) : null;
}

export function buildFileModel(
  file: string,
  text: string,
  files: Map<string, string>
): FileModel {
  const dir = dirOf(file);
  const model: FileModel = {
    file,
    dir,
    appVars: new Set(),
    routerVars: new Set(),
    imports: new Map(),
    namedImports: new Map(),
    exportedRouters: new Set(),
    defaultExport: null,
    mounts: [],
    routes: [],
    functions: new Map(),
  };
  const lines = text.split("\n");

  // --- app / router declarations -----------------------------------------
  const declRe =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(text))) {
    const name = m[1];
    const rhs = m[2];
    if (/express\s*\(\s*\)/.test(rhs) && !/Router/.test(rhs)) {
      model.appVars.add(name);
    } else if (/\.?\bRouter\s*\(\s*\)/.test(rhs) || /express\s*\.\s*Router/.test(rhs)) {
      model.routerVars.add(name);
    } else if (/require\(['"]express['"]\)\s*\(\s*\)/.test(rhs)) {
      model.appVars.add(name);
    }
  }
  // destructured Router: const { Router } = require('express'); const r = Router()
  if (/\bRouter\s*\(\s*\)/.test(text)) {
    const r2 = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\bRouter\s*\(\s*\)/g;
    let mm: RegExpExecArray | null;
    while ((mm = r2.exec(text))) model.routerVars.add(mm[1]);
  }

  // --- imports ------------------------------------------------------------
  const importRe =
    /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\}\s*from\s*)?(?:from\s+)?['"]([^'"]+)['"]/g;
  while ((m = importRe.exec(text))) {
    const def = m[1];
    const named = m[2];
    const spec = m[3];
    const resolved = resolveRelative(dir, spec, files);
    if (!resolved) continue;
    if (def && !["{", "*", "from"].includes(def)) model.imports.set(def, resolved);
    if (named) {
      for (const part of named.split(",")) {
        const nm = part.trim().match(/^(?:([A-Za-z_$][\w$]*)\s+as\s+)?([A-Za-z_$][\w$]*)$/);
        if (nm) {
          const exported = nm[1] ?? nm[2];
          const local = nm[2];
          model.namedImports.set(local, { file: resolved, exported });
          model.imports.set(local, resolved);
        }
      }
    }
  }
  // import x = require / const x = require('...')
  const reqRe = /(?:const|let|var)\s+(?:\{([^}]*)\}\s*=\s*|([A-Za-z_$][\w$]*)\s*=\s*)require\(['"]([^'"]+)['"]\)/g;
  while ((m = reqRe.exec(text))) {
    const destr = m[1];
    const single = m[2];
    const spec = m[3];
    const resolved = resolveRelative(dir, spec, files);
    if (!resolved) continue;
    if (single) model.imports.set(single, resolved);
    if (destr) {
      for (const part of destr.split(",")) {
        const nm = part.trim().match(/^(?:([A-Za-z_$][\w$]*)\s*:\s*)?([A-Za-z_$][\w$]*)$/);
        if (nm) {
          const exported = nm[1] ?? nm[2];
          const local = nm[2];
          model.namedImports.set(local, { file: resolved, exported });
          model.imports.set(local, resolved);
        }
      }
    }
  }

  // --- exports ------------------------------------------------------------
  const defExp = text.match(/export\s+default\s+([A-Za-z_$][\w$]*)/);
  if (defExp) {
    model.defaultExport = defExp[1];
    if (model.routerVars.has(defExp[1])) model.exportedRouters.add(defExp[1]);
  }
  const modExp = text.match(/module\.exports\s*=\s*([A-Za-z_$][\w$]*)/);
  if (modExp) {
    model.defaultExport = modExp[1];
    if (model.routerVars.has(modExp[1])) model.exportedRouters.add(modExp[1]);
  }
  const namedExp = [...text.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)];
  for (const ne of namedExp) {
    if (model.routerVars.has(ne[1])) model.exportedRouters.add(ne[1]);
  }
  const expList = [...text.matchAll(/export\s*\{([^}]*)\}/g)];
  for (const el of expList) {
    for (const part of el[1].split(",")) {
      const nm = part.trim().match(/^(?:([A-Za-z_$][\w$]*)\s+as\s+)?([A-Za-z_$][\w$]*)$/);
      if (nm && model.routerVars.has(nm[1] ?? nm[2])) {
        model.exportedRouters.add(nm[1] ?? nm[2]);
      }
    }
  }

  // --- same-file named handlers -------------------------------------------
  const fnRe =
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  while ((m = fnRe.exec(text))) {
    const name = m[1];
    const braceIdx = m.index + m[0].lastIndexOf("{");
    const bal = readBalanced(text, braceIdx, "{", "}");
    if (bal) model.functions.set(name, bal.inner);
  }
  const arrowRe =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;
  while ((m = arrowRe.exec(text))) {
    const name = m[1];
    const braceIdx = m.index + m[0].lastIndexOf("{");
    const bal = readBalanced(text, braceIdx, "{", "}");
    if (bal && !model.functions.has(name)) model.functions.set(name, bal.inner);
  }

  // --- mounts: X.use('/prefix', child) ------------------------------------
  const useRe = /([A-Za-z_$][\w$]*)\.use\s*\(/g;
  while ((m = useRe.exec(text))) {
    const parent = m[1];
    const openIdx = m.index + m[0].length - 1;
    const bal = readBalanced(text, openIdx);
    if (!bal) continue;
    const args = splitTopLevelArgs(bal.inner);
    if (args.length < 2) continue;
    const prefix = stringLiteral(args[0]);
    if (prefix === null) continue; // app.use(middleware) — not a mount
    for (const rest of args.slice(1)) {
      const child = identifierOf(rest);
      if (child) {
        model.mounts.push({
          parent,
          prefix,
          child,
          line: lineOf(text, m.index),
        });
      }
    }
  }

  // --- routes: X.get('/path', ...) ----------------------------------------
  const routeRe = new RegExp(
    `([A-Za-z_$][\\w$]*)\\.(${ROUTE_VERBS.join("|")})\\s*\\(`,
    "g"
  );
  const consumed = new Set<number>();
  while ((m = routeRe.exec(text))) {
    const hostVar = m[1];
    const method = m[2].toUpperCase();
    if (method === "ALL") continue;
    // skip chained .route().get — handled below (avoid double count)
    const before = text.slice(Math.max(0, m.index - 120), m.index);
    if (/\.route\s*\([^)]*\)\s*$/.test(before)) continue;
    const openIdx = m.index + m[0].length - 1;
    const bal = readBalanced(text, openIdx);
    if (!bal) continue;
    const args = splitTopLevelArgs(bal.inner);
    if (!args.length) continue;
    const pathLit = stringLiteral(args[0]);
    if (pathLit === null) continue;
    if (consumed.has(openIdx)) continue;
    consumed.add(openIdx);
    const line = lineOf(text, m.index);
    const middlewares: string[] = [];
    let handlerBody: string | null = null;
    let handlerName: string | null = null;
    for (const a of args.slice(1)) {
      if (isInlineHandler(a)) {
        handlerBody = extractHandlerBody(a);
      } else {
        const id = identifierOf(a);
        if (id) {
          middlewares.push(id);
          handlerName = id;
        } else {
          // member expression like auth.verify — keep for auth detection
          const mem = a.trim().match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)/);
          if (mem) {
            middlewares.push(mem[1]);
            if (/authenticate|verify|protect|guard/i.test(mem[1])) {
              handlerName = handlerName ?? mem[1];
            }
          }
        }
      }
    }
    // The last identifier middleware is usually the handler; resolve its body.
    if (!handlerBody && handlerName && model.functions.has(handlerName.split(".")[0])) {
      const fn = model.functions.get(handlerName.split(".")[0]);
      if (fn) handlerBody = fn;
    }
    model.routes.push({
      hostVar,
      method,
      path: pathLit,
      line,
      middlewares,
      handlerBody,
      handlerName,
      comment: precedingComment(lines, line - 1),
    });
  }

  // --- chained routes: X.route('/path').get(...).post(...) -----------------
  const chainRe = /([A-Za-z_$][\w$]*)\.route\s*\(/g;
  while ((m = chainRe.exec(text))) {
    const hostVar = m[1];
    const openIdx = m.index + m[0].length - 1;
    const bal = readBalanced(text, openIdx);
    if (!bal) continue;
    const args = splitTopLevelArgs(bal.inner);
    const pathLit = args.length ? stringLiteral(args[0]) : null;
    if (pathLit === null) continue;
    const rest = text.slice(bal.end, bal.end + 2000);
    const verbRe = new RegExp(`^\\s*\\.(${ROUTE_VERBS.join("|")})\\s*\\(`);
    // walk chained verbs
    let cursor = 0;
    let guard = 0;
    while (guard++ < 12) {
      const vm = rest.slice(cursor).match(verbRe);
      if (!vm || vm.index === undefined) break;
      const absIdx = bal.end + cursor + vm.index + vm[0].length - 1;
      const vb = readBalanced(text, absIdx);
      if (!vb) break;
      const vargs = splitTopLevelArgs(vb.inner);
      const middlewares: string[] = [];
      let handlerBody: string | null = null;
      for (const a of vargs) {
        if (isInlineHandler(a)) handlerBody = extractHandlerBody(a);
        else {
          const id = identifierOf(a);
          if (id) middlewares.push(id);
        }
      }
      const line = lineOf(text, absIdx);
      model.routes.push({
        hostVar,
        method: vm[1].toUpperCase(),
        path: pathLit,
        line,
        middlewares,
        handlerBody,
        handlerName: null,
        comment: precedingComment(lines, line - 1),
      });
      // -1: vm[0] already includes '(' which vb.end-absIdx also spans
      cursor += vm.index + vm[0].length + (vb.end - absIdx) - 1;
      void consumed;
    }
  }

  return model;
}

function inferBodyFields(handlerBody: string | null): {
  present: boolean;
  fields: SchemaField[];
} {
  if (!handlerBody) return { present: false, fields: [] };
  const fields: SchemaField[] = [];
  const seen = new Set<string>();
  const destr = handlerBody.match(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*req\.body\b/);
  if (destr) {
    for (const part of destr[1].split(",")) {
      const nm = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      if (nm && !seen.has(nm[1])) {
        seen.add(nm[1]);
        fields.push({
          name: nm[1],
          type: "string",
          required: false,
          origin: "req.body destructuring",
          confidence: "inferred",
        });
      }
    }
  }
  for (const mm of handlerBody.matchAll(/req\.body(?:\??\.)([A-Za-z_$][\w$]*)/g)) {
    if (!seen.has(mm[1])) {
      seen.add(mm[1]);
      fields.push({
        name: mm[1],
        type: "string",
        required: false,
        origin: "req.body access",
        confidence: "inferred",
      });
    }
  }
  const present = fields.length > 0 || /req\.body\b/.test(handlerBody);
  return { present, fields };
}

function inferQueryParams(
  handlerBody: string | null,
  path: string
): ApiParam[] {
  const out: ApiParam[] = [];
  const seen = new Set<string>();
  // path params from :id style
  for (const mm of path.matchAll(/:([A-Za-z_][\w]*)/g)) {
    const name = mm[1];
    if (!seen.has(`path:${name}`)) {
      seen.add(`path:${name}`);
      out.push({
        name,
        in: "path",
        required: true,
        type: "string",
        origin: "route path",
        confidence: "detected",
      });
    }
  }
  if (handlerBody) {
    const destr = handlerBody.match(
      /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*req\.query\b/
    );
    if (destr) {
      for (const part of destr[1].split(",")) {
        const nm = part.trim().match(/^([A-Za-z_$][\w$]*)/);
        if (nm && !seen.has(`query:${nm[1]}`)) {
          seen.add(`query:${nm[1]}`);
          out.push({
            name: nm[1],
            in: "query",
            required: false,
            type: "string",
            origin: "req.query destructuring",
            confidence: "inferred",
          });
        }
      }
    }
    for (const mm of handlerBody.matchAll(/req\.query(?:\??\.)([A-Za-z_$][\w$]*)/g)) {
      if (!seen.has(`query:${mm[1]}`)) {
        seen.add(`query:${mm[1]}`);
        out.push({
          name: mm[1],
          in: "query",
          required: false,
          type: "string",
          origin: "req.query access",
          confidence: "inferred",
        });
      }
    }
  }
  return out;
}

function inferResponses(handlerBody: string | null, method: string): ResponseShape[] {
  const statuses = new Set<string>();
  if (handlerBody) {
    for (const mm of handlerBody.matchAll(/res\s*\.\s*status\s*\(\s*(\d{3})\s*\)/g)) {
      statuses.add(mm[1]);
    }
    if (/res\s*\.\s*(json|send|end)\s*\(/.test(handlerBody)) {
      if (statuses.size === 0) statuses.add(method === "POST" ? "201" : "200");
    }
  }
  if (statuses.size === 0) {
    statuses.add(method === "POST" ? "201" : "200");
  }
  return [...statuses].sort().map((s) => ({
    status: s,
    description: s.startsWith("2") ? "Success" : "Response",
    fields: [],
    origin: handlerBody ? "res.status/json inference" : "REST default",
    confidence: "inferred",
  }));
}

/** Resolve full mount prefixes across files (nested routers + imports). */
function resolvePrefixes(
  models: Map<string, FileModel>
): Map<string, string> {
  const key = (f: string, v: string) => `${f}${v}`;
  const edges: MountEdge[] = [];
  const prefix = new Map<string, string>();

  for (const [, model] of models) {
    for (const v of model.appVars) prefix.set(key(model.file, v), "");
    for (const mount of model.mounts) {
      // local edge (same file)
      if (
        model.routerVars.has(mount.child) ||
        model.appVars.has(mount.child)
      ) {
        edges.push({
          fromFile: model.file,
          fromVar: mount.parent,
          prefix: mount.prefix,
          toFile: model.file,
          toVar: mount.child,
        });
        continue;
      }
      // imported child: parent.use('/p', importedRouter)
      const targetFile = model.imports.get(mount.child);
      if (targetFile) {
        const target = models.get(targetFile);
        const named = model.namedImports.get(mount.child);
        if (target) {
          const candidates: string[] = [];
          if (named && target.routerVars.has(named.exported)) {
            candidates.push(named.exported);
          }
          if (target.defaultExport && target.routerVars.has(target.defaultExport)) {
            candidates.push(target.defaultExport);
          }
          for (const r of target.exportedRouters) candidates.push(r);
          // fallback: if target has exactly one router var, use it
          if (!candidates.length && target.routerVars.size === 1) {
            candidates.push([...target.routerVars][0]);
          }
          for (const c of candidates) {
            edges.push({
              fromFile: model.file,
              fromVar: mount.parent,
              prefix: mount.prefix,
              toFile: targetFile,
              toVar: c,
            });
          }
        }
      }
    }
  }

  // Fixpoint propagation from app roots.
  let changed = true;
  let rounds = 0;
  while (changed && rounds++ < 12) {
    changed = false;
    for (const e of edges) {
      const from = prefix.get(key(e.fromFile, e.fromVar));
      if (from === undefined) continue;
      const toKey = key(e.toFile, e.toVar);
      const next = joinPaths(from, e.prefix);
      if (prefix.get(toKey) !== next) {
        // keep the first (shortest-path) resolution for determinism
        if (!prefix.has(toKey)) {
          prefix.set(toKey, next);
          changed = true;
        }
      }
    }
  }
  // Unmounted routers keep "" (best effort; route still reported).
  for (const [, model] of models) {
    for (const v of model.routerVars) {
      const k = key(model.file, v);
      if (!prefix.has(k)) prefix.set(k, "");
    }
  }
  return prefix;
}

export function parseExpressFiles(
  files: Map<string, string>
): { endpoints: EndpointContract[]; models: Map<string, FileModel> } {
  const jsFiles = [...files.entries()].filter(([f]) =>
    /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f)
  );
  const models = new Map<string, FileModel>();
  for (const [file, text] of jsFiles) {
    try {
      models.set(file, buildFileModel(file, text, files));
    } catch {
      // A single unparseable file must never break the whole scan.
    }
  }
  return { endpoints: assembleExpressEndpoints(models), models };
}

/**
 * Cheap assembly step: mount-prefix resolution + endpoint shaping.
 * Rerun over merged models after incremental re-parse.
 */
export function assembleExpressEndpoints(
  models: Map<string, FileModel>
): EndpointContract[] {
  const prefixes = resolvePrefixes(models);
  const key = (f: string, v: string) => `${f}${v}`;
  const endpoints: EndpointContract[] = [];

  for (const [, model] of models) {
    for (const r of model.routes) {
      if (!model.routerVars.has(r.hostVar) && !model.appVars.has(r.hostVar)) {
        continue; // e.g. axios.get / fetch wrappers — not route definitions
      }
      const mountPrefix = prefixes.get(key(model.file, r.hostVar)) ?? "";
      const fullPath = normalizePath(joinPaths(mountPrefix, r.path));
      const { present, fields } = inferBodyFields(r.handlerBody);
      const params = inferQueryParams(r.handlerBody, r.path);
      // body present inference also from method
      const wantsBody = ["POST", "PUT", "PATCH"].includes(r.method);
      const middleNames = r.middlewares.join(" ");
      const authHit = r.middlewares.filter((mw) => looksLikeAuthMiddleware(mw));
      const authDetected = /passport\.authenticate|express-jwt|requireAuth|verifyToken|authenticate\(/.test(
        middleNames
      );
      const summary =
        r.comment?.split(".")[0].slice(0, 120) ?? `${r.method} ${fullPath}`;
      endpoints.push({
        id: endpointId(r.method, fullPath),
        method: r.method as EndpointContract["method"],
        path: fullPath,
        controller: model.file.split("/").pop(),
        sourceFile: model.file,
        sourceLine: r.line,
        framework: "express",
        pathParams: params.filter((p) => p.in === "path"),
        queryParams: params.filter((p) => p.in === "query"),
        requestBody:
          present || wantsBody
            ? {
                contentType: "application/json",
                fields,
                present: present || fields.length > 0,
                origin: fields.length
                  ? "handler req.body inference"
                  : "method default (no body fields observed)",
                confidence: "inferred",
              }
            : undefined,
        responses: inferResponses(r.handlerBody, r.method),
        auth:
          authHit.length > 0
            ? {
                required: true,
                schemes: authHit.slice(0, 3),
                description: `Guarded by middleware: ${authHit.slice(0, 3).join(", ")}`,
                origin: "auth middleware",
                confidence: authDetected ? "detected" : "inferred",
              }
            : {
                required: false,
                schemes: [],
                description: "No auth middleware observed on this route",
                origin: "route middleware scan",
                confidence: "inferred",
              },
        summary,
        description: r.comment ?? undefined,
        confidence: "detected",
      });
    }
  }

  // de-dupe identical definitions (same method+path+file), keep first
  const seen = new Set<string>();
  const deduped = endpoints.filter((e) => {
    const k = `${e.id}${e.sourceFile}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  void mapTsType;
  return deduped;
}

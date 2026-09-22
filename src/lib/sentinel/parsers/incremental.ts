/**
 * Incremental extraction: re-parse only changed files, reuse cached
 * per-file models for everything else, then re-assemble endpoints over the
 * merged models (so cross-file mounts/prefixes stay correct).
 */
import type { EndpointContract } from "../types";
import { sha256Hex } from "../security/guards";
import type { ScanPlan } from "./index";
import { detectFramework } from "./framework";
import {
  assembleExpressEndpoints,
  buildFileModel,
  deserializeFileModel,
  serializeFileModel,
  type FileModel,
  type SerializedFileModel,
} from "./express";
import {
  assembleFastApiEndpoints,
  buildFastApiFileModel,
  type FastApiFileModel,
} from "./fastapi";
import {
  assembleSpringEndpoints,
  buildSpringFileModel,
  type SpringFileModel,
} from "./spring";

export interface ParseCache {
  fileSha: Record<string, string>;
  express: Record<string, SerializedFileModel>;
  fastapi: Record<string, FastApiFileModel>;
  spring: Record<string, SpringFileModel>;
}

export function emptyParseCache(): ParseCache {
  return { fileSha: {}, express: {}, fastapi: {}, spring: {} };
}

export interface IncrementalResult {
  endpoints: EndpointContract[];
  reparsed: string[];
  reused: string[];
  deleted: string[];
  framework: ReturnType<typeof detectFramework>;
  cache: ParseCache;
  contributingFiles: string[];
}

const isJs = (f: string) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f);
const isPy = (f: string) => f.endsWith(".py");
const isJava = (f: string) => f.endsWith(".java");

export function extractIncremental(
  plan: ScanPlan,
  prevCache: ParseCache | null,
  opts: { forceFull?: boolean } = {}
): IncrementalResult {
  const { analyzable } = plan;
  const cache: ParseCache = {
    fileSha: {},
    express: {},
    fastapi: {},
    spring: {},
  };
  const reparsed: string[] = [];
  const reused: string[] = [];

  const expressModels = new Map<string, FileModel>();
  const fastapiModels = new Map<string, FastApiFileModel>();
  const springModels = new Map<string, SpringFileModel>();

  for (const [file, content] of analyzable) {
    const sha = sha256Hex(content).slice(0, 16);
    cache.fileSha[file] = sha;
    const cached = !opts.forceFull && prevCache && prevCache.fileSha[file] === sha;

    if (isJs(file)) {
      if (cached && prevCache!.express[file]) {
        expressModels.set(file, deserializeFileModel(prevCache!.express[file]));
        cache.express[file] = prevCache!.express[file];
        reused.push(file);
      } else {
        try {
          const m = buildFileModel(file, content, analyzable);
          expressModels.set(file, m);
          cache.express[file] = serializeFileModel(m);
        } catch {
          /* single-file failure never breaks the scan */
        }
        reparsed.push(file);
      }
    } else if (isPy(file)) {
      if (cached && prevCache!.fastapi[file]) {
        fastapiModels.set(file, prevCache!.fastapi[file]);
        cache.fastapi[file] = prevCache!.fastapi[file];
        reused.push(file);
      } else {
        try {
          const m = buildFastApiFileModel(file, content);
          fastapiModels.set(file, m);
          cache.fastapi[file] = m;
        } catch {
          /* ignore */
        }
        reparsed.push(file);
      }
    } else if (isJava(file)) {
      if (cached && prevCache!.spring[file]) {
        springModels.set(file, prevCache!.spring[file]);
        cache.spring[file] = prevCache!.spring[file];
        reused.push(file);
      } else {
        try {
          const m = buildSpringFileModel(file, content);
          springModels.set(file, m);
          cache.spring[file] = m;
        } catch {
          /* ignore */
        }
        reparsed.push(file);
      }
    }
  }

  const deleted = prevCache
    ? Object.keys(prevCache.fileSha).filter((f) => !analyzable.has(f))
    : [];

  // Assemble over merged models (cheap) — cross-file resolution stays exact.
  let endpoints: EndpointContract[] = [];
  if (expressModels.size) endpoints.push(...assembleExpressEndpoints(expressModels));
  if (fastapiModels.size) endpoints.push(...assembleFastApiEndpoints(fastapiModels, analyzable));
  if (springModels.size) endpoints.push(...assembleSpringEndpoints(springModels));

  // Contract-level dedupe: (method, path) is the identity. When several files
  // define the same route, the first in deterministic file order wins and the
  // rest are dropped (they cannot all be the contract).
  endpoints.sort((a, b) =>
    a.path === b.path
      ? a.method === b.method
        ? a.sourceFile.localeCompare(b.sourceFile) || a.sourceLine - b.sourceLine
        : a.method.localeCompare(b.method)
      : a.path.localeCompare(b.path)
  );
  const seen = new Set<string>();
  endpoints = endpoints.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  return {
    endpoints,
    reparsed: reparsed.sort(),
    reused: reused.sort(),
    deleted: deleted.sort(),
    framework: detectFramework(analyzable),
    cache,
    contributingFiles: [...new Set(endpoints.map((e) => e.sourceFile))].sort(),
  };
}

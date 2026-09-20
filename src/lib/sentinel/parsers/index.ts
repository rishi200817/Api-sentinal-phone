/**
 * Scan orchestration: safe file filtering + per-framework extraction.
 * Protections: excluded dirs, binary detection, size caps, secret hygiene
 * (scan only — findings never include secret values).
 */
import type {
  EndpointContract,
  Framework,
  FrameworkDetection,
  ParseFileResult,
  ScanLimits,
} from "../types";
import { MAX_FILE_BYTES, MAX_REPO_FILES_ANALYZED } from "../security/guards";
import { detectFramework } from "./framework";
import { parseExpressFiles } from "./express";
import { parseFastApiFiles } from "./fastapi";
import { parseSpringFiles } from "./spring";

const EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".parcel-cache",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".gradle",
  ".idea",
  ".vscode",
];

const EXCLUDED_FILES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "poetry.lock",
  "Gemfile.lock",
  "composer.lock",
];

const CODE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "java"];

const BINARY_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg",
  "mp4", "mp3", "wav", "ogg", "flac", "mov",
  "zip", "tar", "gz", "rar", "7z", "jar", "war", "class",
  "pdf", "doc", "docx", "xls", "xlsx",
  "ttf", "otf", "woff", "woff2", "eot",
  "exe", "dll", "so", "dylib", "bin",
  "pyc", "pyo", "node",
  "map", "lock",
];

export function classifyFile(file: string): { ignore: boolean; reason?: string } {
  const lower = file.toLowerCase();
  const parts = lower.split("/");
  for (const d of EXCLUDED_DIRS) {
    if (parts.includes(d)) return { ignore: true, reason: `inside excluded dir '${d}'` };
  }
  const base = parts[parts.length - 1];
  if (EXCLUDED_FILES.includes(base)) {
    return { ignore: true, reason: "lockfile (not API-relevant)" };
  }
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  if (BINARY_EXTENSIONS.includes(ext)) {
    return { ignore: true, reason: `binary/asset extension .${ext}` };
  }
  return { ignore: false };
}

export function isApiRelevant(file: string): boolean {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return CODE_EXTENSIONS.includes(ext);
}

export function isOpenApiFile(file: string): boolean {
  const base = file.split("/").pop()!.toLowerCase();
  return (
    /^(openapi|swagger)[\w.-]*\.(ya?ml|json)$/.test(base) ||
    base.endsWith(".openapi.yaml") ||
    base.endsWith(".openapi.yml") ||
    base.endsWith(".openapi.json")
  );
}

function looksBinary(content: string): boolean {
  // Content arriving as string with NULs, or excessive non-text chars.
  if (content.includes("\0")) return true;
  const sample = content.slice(0, 4000);
  let odd = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32 && c !== 27)) odd++;
  }
  return odd > sample.length * 0.02;
}

export interface ScanPlan {
  analyzable: Map<string, string>;
  /** Parsed for impact/consumers only — never treated as the API contract. */
  consumerOnly: Map<string, string>;
  ignored: { file: string; reason: string }[];
  openapiFiles: { file: string; content: string }[];
  limits: ScanLimits;
}

/**
 * Directories whose code is NEVER the API contract (tests, docs, samples)
 * but IS searched for consumer references during impact analysis.
 */
const CONSUMER_ONLY_DIRS = new Set([
  "tests",
  "test",
  "__tests__",
  "__mocks__",
  "spec",
  "specs",
  "docs",
  "docs_src",
  "doc",
  "examples",
  "example",
  "samples",
  "sample",
  "tutorials",
  "tutorial",
  "demo",
  "demos",
  "playground",
  "e2e",
]);

export function isConsumerOnlyPath(file: string): boolean {
  const parts = file.toLowerCase().split("/");
  if (parts.some((p) => CONSUMER_ONLY_DIRS.has(p))) return true;
  const base = parts[parts.length - 1];
  return (
    base.startsWith("test_") ||
    base.startsWith("spec_") ||
    /\.(test|spec)\.[^.]+$/.test(base) ||
    base.endsWith("_test.py") ||
    base.endsWith("_test.go") ||
    /(^|\/)test[^/]*\.py$/.test(file.toLowerCase())
  );
}

/** Filter raw repo files into an analyzable set with transparent limits. */
export function planScan(allFiles: Map<string, string>): ScanPlan {
  const analyzable = new Map<string, string>();
  const consumerOnly = new Map<string, string>();
  const ignored: { file: string; reason: string }[] = [];
  const openapiFiles: { file: string; content: string }[] = [];
  let bytes = 0;
  let truncated = false;

  for (const [file, content] of allFiles) {
    const cls = classifyFile(file);
    if (cls.ignore) {
      ignored.push({ file, reason: cls.reason! });
      continue;
    }
    const consumerLane = isConsumerOnlyPath(file);
    const size = content.length;
    if (size > MAX_FILE_BYTES) {
      ignored.push({
        file,
        reason: `file too large (${(size / 1024).toFixed(0)}KB > 512KB cap)`,
      });
      continue;
    }
    if (looksBinary(content)) {
      ignored.push({ file, reason: "binary content detected" });
      continue;
    }
    if (isOpenApiFile(file)) {
      openapiFiles.push({ file, content });
      bytes += size;
      continue;
    }
    if (!isApiRelevant(file)) {
      ignored.push({ file, reason: "not a code/OpenAPI file" });
      continue;
    }
    if (consumerLane) {
      consumerOnly.set(file, content);
      bytes += size;
      continue;
    }
    if (analyzable.size >= MAX_REPO_FILES_ANALYZED) {
      truncated = true;
      ignored.push({ file, reason: "repo file cap reached (1200 analyzed)" });
      continue;
    }
    analyzable.set(file, content);
    bytes += size;
  }

  return {
    analyzable,
    consumerOnly,
    ignored,
    openapiFiles,
    limits: {
      filesScanned: allFiles.size,
      apiFilesAnalyzed: analyzable.size,
      filesSkipped: ignored.map((i) => i.file),
      bytesScanned: bytes,
      truncated,
      consumerOnlyFiles: consumerOnly.size,
    },
  };
}

export interface ExtractionResult {
  endpoints: EndpointContract[];
  framework: FrameworkDetection;
  perFile: ParseFileResult[];
  /** files that produced at least one endpoint */
  contributingFiles: string[];
  frameworkByFile: Map<string, Framework>;
}

/** Run framework detection + all applicable parsers over scanned files. */
export function extractEndpoints(plan: ScanPlan): ExtractionResult {
  const { analyzable } = plan;
  const t0 = Date.now();
  const framework = detectFramework(analyzable);
  const perFile: ParseFileResult[] = [];
  const contributing = new Set<string>();
  const frameworkByFile = new Map<string, Framework>();

  const hasJs = [...analyzable.keys()].some((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));
  const hasPy = [...analyzable.keys()].some((f) => f.endsWith(".py"));
  const hasJava = [...analyzable.keys()].some((f) => f.endsWith(".java"));

  let endpoints: EndpointContract[] = [];

  // Always run every applicable parser (polyglot repos exist); framework
  // detection guides messaging, not parser selection.
  if (hasJs) {
    try {
      const r = parseExpressFiles(analyzable);
      endpoints.push(...r.endpoints);
      for (const e of r.endpoints) contributing.add(e.sourceFile);
    } catch (err) {
      perFile.push({
        file: "(express parser)",
        framework: "express",
        endpoints: [],
        skipped: true,
        skipReason: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      });
    }
  }
  if (hasPy) {
    try {
      const r = parseFastApiFiles(analyzable);
      endpoints.push(...r.endpoints);
      for (const e of r.endpoints) contributing.add(e.sourceFile);
    } catch (err) {
      perFile.push({
        file: "(fastapi parser)",
        framework: "fastapi",
        endpoints: [],
        skipped: true,
        skipReason: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      });
    }
  }
  if (hasJava) {
    try {
      const r = parseSpringFiles(analyzable);
      endpoints.push(...r.endpoints);
      for (const e of r.endpoints) contributing.add(e.sourceFile);
    } catch (err) {
      perFile.push({
        file: "(spring parser)",
        framework: "spring",
        endpoints: [],
        skipped: true,
        skipReason: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      });
    }
  }

  for (const f of analyzable.keys()) {
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f)) frameworkByFile.set(f, "express");
    else if (f.endsWith(".py")) frameworkByFile.set(f, "fastapi");
    else if (f.endsWith(".java")) frameworkByFile.set(f, "spring");
  }
  void t0;

  // Contract-level dedupe: (method, path) is the identity.
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
    framework,
    perFile,
    contributingFiles: [...contributing].sort(),
    frameworkByFile,
  };
}

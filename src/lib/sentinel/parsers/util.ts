/** Shared parser utilities. */
import type { Framework, HttpMethod } from "../types";

export const HTTP_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

export function normalizePath(raw: string): string {
  let p = raw.trim();
  // Express-style :param -> OpenAPI {param} (ignore regex constraints)
  p = p.replace(/:([A-Za-z_][\w]*)/g, "{$1}");
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

export function joinPaths(...parts: string[]): string {
  return normalizePath(
    parts
      .filter(Boolean)
      .map((p) => p.trim())
      .join("/")
  );
}

export function endpointId(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizePath(path)}`;
}

export function guessFrameworkFromFile(file: string): Framework | null {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) return "express";
  if (/\.py$/.test(file)) return "fastapi";
  if (/\.java$/.test(file)) return "spring";
  return null;
}

export function isProbablyTestFile(file: string): boolean {
  return /(^|\/)(__tests__|tests?|spec|__mocks__)\//.test(file) ||
    /\.(test|spec)\.[^.]+$/.test(file);
}

/** Strip string-literal contents to reduce false decorator/call matches. */
export function stripStrings(line: string): string {
  return line.replace(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g, (m) =>
    m[0] + "…" + m[0]
  );
}

/** Extract the first string literal from a call-arg prefix. */
export function firstStringLiteral(text: string): string | null {
  const m = text.match(/['"`]([^'"`]+)['"`]/);
  return m ? m[1] : null;
}

/**
 * Read a balanced call starting at an opening paren index.
 * Returns the inner text and the index just past the closing paren.
 */
export function readBalanced(
  text: string,
  openIdx: number,
  open = "(",
  close = ")"
): { inner: string; end: number } | null {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    // naive template/comment tolerance
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        return { inner: text.slice(openIdx + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

/** Split top-level comma-separated args (paren/brace/bracket aware). */
export function splitTopLevelArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let cur = "";
  const opens = "([{";
  const closes = ")]}";
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (opens.includes(ch)) depth++;
    if (closes.includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Count line number (1-based) of an offset in text. */
export function lineOf(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") n++;
  }
  return n;
}

const AUTH_NAME_RE =
  /(auth|jwt|token|passport|verify|protect|guard|secure|login|session|oauth|api[_-]?key|requireuser|isadmin|hasrole|preauthorize|secured|rolesallowed)/i;

export function looksLikeAuthMiddleware(name: string): boolean {
  return AUTH_NAME_RE.test(name);
}

export function mapTsType(t: string): string {
  const s = t.trim().toLowerCase();
  if (["string", "str"].includes(s)) return "string";
  if (["number", "int", "integer", "float", "double", "long", "bigdecimal"].includes(s))
    return s.includes("float") || s.includes("double") ? "number" : "integer";
  if (["boolean", "bool"].includes(s)) return "boolean";
  if (s.startsWith("array") || s.endsWith("[]") || s.startsWith("list")) return "array";
  if (s.includes("date")) return "string";
  if (["object", "record", "dict", "map", "any", "unknown"].includes(s)) return "object";
  return "string";
}

export function mapPyType(t: string): string {
  const s = t.replace(/\s+/g, "").toLowerCase();
  if (s.startsWith("list") || s.startsWith("array")) return "array";
  if (s.startsWith("dict") || s.startsWith("mapping")) return "object";
  if (s.includes("int") && !s.includes("print")) return "integer";
  if (s.includes("float") || s.includes("decimal")) return "number";
  if (s.includes("bool")) return "boolean";
  return "string";
}

export function mapJavaType(t: string): string {
  const s = t.replace(/\s+/g, "");
  if (/^(int|Integer|long|Long|short|Short|byte|Byte)$/.test(s)) return "integer";
  if (/^(double|Double|float|Float|BigDecimal)$/.test(s)) return "number";
  if (/^(boolean|Boolean)$/.test(s)) return "boolean";
  if (/^(List|Set|Collection|.*\[\])/.test(s)) return "array";
  if (/^(Map|Object|JsonNode|.*Dto|.*DTO|.*Request|.*Response)$/.test(s)) return "object";
  return "string";
}

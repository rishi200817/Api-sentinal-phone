/**
 * Impact analysis: finds likely API consumers in the repository.
 * Static text search with confidence tiers. Never claims a consumer is
 * broken — only that a reference exists.
 */
import type { ApiChange, ImpactFinding } from "../types";

interface ConsumerHit {
  file: string;
  line: number;
  snippet: string;
  strength: number; // 0..3
  reason: string;
}

function pathVariants(path: string): string[] {
  // /api/users/{id} -> ["/api/users/", "/api/users", "api/users", ...]
  const noParams = path.replace(/\{[^}]+\}/g, "").replace(/\/+/g, "/");
  const collapsed = noParams.endsWith("/") && noParams.length > 1
    ? noParams.slice(0, -1)
    : noParams;
  const set = new Set<string>();
  set.add(path);
  set.add(collapsed);
  set.add(collapsed.replace(/^\//, ""));
  // template-literal style: /api/users/${id}
  set.add(path.replace(/\{([^}]+)\}/g, "${$1}"));
  return [...set].filter(Boolean);
}

function scanFileForPath(
  file: string,
  content: string,
  pathVars: string[],
  fieldNames: string[]
): ConsumerHit[] {
  const out: ConsumerHit[] = [];
  const lines = content.split("\n");
  const cap = Math.min(lines.length, 6000);
  for (let i = 0; i < cap; i++) {
    const line = lines[i];
    if (line.length > 1200) continue;
    let strength = 0;
    const reasons: string[] = [];
    for (const v of pathVars) {
      if (v.length >= 4 && line.includes(v)) {
        strength = Math.max(strength, v.includes("{") || v.includes("$") ? 3 : 2);
        reasons.push(`references '${v.length > 40 ? v.slice(0, 40) + "…" : v}'`);
        break;
      }
    }
    if (strength === 0) continue;
    // field co-occurrence boosts confidence
    const lower = line.toLowerCase();
    const fieldHits = fieldNames.filter(
      (f) => f.length >= 3 && lower.includes(f.toLowerCase())
    );
    if (fieldHits.length) {
      strength = Math.min(3, strength + 1);
      reasons.push(`mentions ${fieldHits.slice(0, 3).join(", ")}`);
    }
    // fetch/axios/http call context
    if (/(fetch|axios|http\.(get|post|put|patch|delete)|requests\.(get|post)|HttpClient|RestTemplate|WebClient|\.get\(|\.post\()/.test(line)) {
      strength = Math.min(3, strength + 1);
      reasons.push("inside HTTP call");
    }
    out.push({
      file,
      line: i + 1,
      snippet: line.trim().slice(0, 220),
      strength,
      reason: reasons.join("; "),
    });
    if (out.length >= 12) break;
  }
  return out;
}

function tierOf(strength: number): ImpactFinding["matchKind"] {
  if (strength >= 3) return "verified-reference";
  if (strength === 2) return "likely-consumer";
  if (strength === 1) return "reference-found";
  return "potential";
}

/**
 * Find likely consumers of the changed endpoints across repo files.
 * Excludes the endpoint's own definition file (self-reference).
 */
export function analyzeImpact(
  changes: ApiChange[],
  files: Map<string, string>,
  opts: { maxFindingsPerChange?: number } = {}
): ImpactFinding[] {
  const maxPer = opts.maxFindingsPerChange ?? 8;
  const findings: ImpactFinding[] = [];

  // searchable: text-ish files only
  const searchable = [...files.entries()].filter(
    ([f, c]) =>
      c.length < 512 * 1024 &&
      !f.includes("node_modules") &&
      !f.includes(".git/") &&
      /\.(ts|tsx|js|jsx|mjs|cjs|py|java|kt|swift|dart|go|rs|rb|php|cs|vue|svelte|html|md|txt|json|yaml|yml)$/.test(f)
  );

  for (const change of changes) {
    if (change.type !== "REQUEST_SCHEMA_CHANGED" &&
        change.type !== "RESPONSE_SCHEMA_CHANGED" &&
        change.type !== "PARAMETER_CHANGED" &&
        change.type !== "DELETED_ENDPOINT" &&
        change.type !== "METHOD_CHANGED" &&
        change.type !== "AUTH_CHANGED") {
      continue;
    }
    const vars = pathVariants(change.path);
    const fieldNames = change.fieldChanges
      .map((f) => f.field)
      .filter((x): x is string => !!x);
    const selfFiles = new Set(
      [change.before?.sourceFile, change.after?.sourceFile].filter(Boolean) as string[]
    );
    const hits: ConsumerHit[] = [];
    for (const [file, content] of searchable) {
      if (selfFiles.has(file)) continue;
      hits.push(...scanFileForPath(file, content, vars, fieldNames));
    }
    hits.sort((a, b) => b.strength - a.strength);
    const seenFiles = new Set<string>();
    let count = 0;
    for (const h of hits) {
      if (count >= maxPer) break;
      const k = `${h.file}:${h.line}`;
      if (seenFiles.has(k)) continue;
      seenFiles.add(k);
      count++;
      findings.push({
        id: `imp_${Math.random().toString(36).slice(2, 10)}`,
        changeId: change.id,
        consumerFile: h.file,
        consumerLine: h.line,
        matchKind: tierOf(h.strength),
        snippet: h.snippet,
        note: h.reason,
      });
    }
  }
  return findings;
}

export const MATCH_KIND_LABEL: Record<ImpactFinding["matchKind"], string> = {
  "verified-reference": "Verified reference",
  "likely-consumer": "Likely consumer",
  "reference-found": "Reference found",
  potential: "Potentially affected",
};

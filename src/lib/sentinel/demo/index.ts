/**
 * Deterministic built-in demo repositories.
 * Fixtures are file maps only — every number, diff, and doc shown in demo
 * mode is computed by the real pipeline from these files.
 */
import { FASTAPI_V1, FASTAPI_V2 } from "./fastapi";
import { EXPRESS_V1, EXPRESS_V2 } from "./express";

export interface DemoRepoDef {
  key: string;
  name: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  description: string;
  versions: { sha: string; label: string; files: Record<string, string> }[];
}

export const DEMO_REPOS: DemoRepoDef[] = [
  {
    key: "demo-fastapi",
    name: "acme-auth-api (demo)",
    owner: "acme",
    repo: "auth-api",
    defaultBranch: "main",
    description:
      "FastAPI auth service. v2 adds required deviceId to login and DELETE /api/users/{id}.",
    versions: [
      { sha: "demo-v1", label: "v1 baseline (healthy)", files: FASTAPI_V1 },
      { sha: "demo-v2", label: "v2 deviceId + delete-user", files: FASTAPI_V2 },
    ],
  },
  {
    key: "demo-express",
    name: "acme-orders-api (demo)",
    owner: "acme",
    repo: "orders-api",
    defaultBranch: "main",
    description:
      "Express orders API with nested routers. v2 adds search, query params, and auth on delete.",
    versions: [
      { sha: "demo-v1", label: "v1 baseline (healthy)", files: EXPRESS_V1 },
      { sha: "demo-v2", label: "v2 search + auth", files: EXPRESS_V2 },
    ],
  },
];

export function demoFiles(key: string, sha: string): Map<string, string> | null {
  const def = DEMO_REPOS.find((d) => d.key === key);
  const ver = def?.versions.find((v) => v.sha === sha);
  if (!def || !ver) return null;
  return new Map(Object.entries(ver.files));
}

export function nextDemoVersion(key: string, currentSha: string | null | undefined): string {
  const def = DEMO_REPOS.find((d) => d.key === key);
  if (!def) return "demo-v1";
  if (!currentSha) return def.versions[0].sha;
  const idx = def.versions.findIndex((v) => v.sha === currentSha);
  if (idx < 0) return def.versions[0].sha;
  // Stay on the latest version once reached (re-analysis => no changes).
  return def.versions[Math.min(idx + 1, def.versions.length - 1)].sha;
}

export function demoChangedFiles(key: string, fromSha: string, toSha: string): string[] {
  const a = demoFiles(key, fromSha);
  const b = demoFiles(key, toSha);
  if (!a || !b) return [];
  const out = new Set<string>();
  for (const [f, content] of b) {
    if (a.get(f) !== content) out.add(f);
  }
  for (const f of a.keys()) {
    if (!b.has(f)) out.add(f);
  }
  return [...out].sort();
}

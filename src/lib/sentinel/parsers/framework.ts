/** Framework detection with explicit confidence + reasons. */
import type { Framework, FrameworkDetection } from "../types";

export interface RepoSignals {
  files: Map<string, string>;
}

export function detectFramework(files: Map<string, string>): FrameworkDetection {
  const scores: Record<Framework, number> = {
    express: 0,
    fastapi: 0,
    spring: 0,
    unknown: 0,
  };
  const signals: string[] = [];
  const add = (fw: Framework, pts: number, signal: string) => {
    scores[fw] += pts;
    signals.push(`[${fw}] ${signal}`);
  };

  const hasFile = (re: RegExp) => [...files.keys()].some((f) => re.test(f));
  const getFile = (name: string) => {
    const hit = [...files.keys()].find(
      (f) => f === name || f.endsWith(`/${name}`)
    );
    return hit ? files.get(hit)! : null;
  };
  const anyContent = (re: RegExp, cap = 4000) => {
    let checked = 0;
    for (const [, content] of files) {
      if (checked++ > cap) break;
      if (re.test(content)) return true;
    }
    return false;
  };

  // --- package manifests -------------------------------------------------
  const pkg = getFile("package.json");
  if (pkg) {
    try {
      const j = JSON.parse(pkg) as { dependencies?: Record<string, string> };
      const deps = { ...(j.dependencies ?? {}) };
      if (deps.express) add("express", 3, `package.json depends on express ${deps.express}`);
      if (deps.fastify) add("express", 1, "package.json mentions fastify (express-family routing not fully supported)");
    } catch {
      /* ignore malformed manifest */
    }
  }
  const req = getFile("requirements.txt");
  if (req && /fastapi/i.test(req)) add("fastapi", 3, "requirements.txt includes fastapi");
  const pyproject = getFile("pyproject.toml");
  if (pyproject && /fastapi/i.test(pyproject)) add("fastapi", 3, "pyproject.toml includes fastapi");
  const pom = getFile("pom.xml");
  if (pom && /spring-boot/i.test(pom)) add("spring", 3, "pom.xml includes spring-boot");
  if (hasFile(/build\.gradle(\.kts)?$/)) {
    const g = getFile("build.gradle") ?? getFile("build.gradle.kts") ?? "";
    if (/spring/i.test(g)) add("spring", 3, "gradle build includes spring");
  }

  // --- code signals ------------------------------------------------------
  if (anyContent(/require\(['"]express['"]\)|from\s+['"]express['"]|import\s+express\b/))
    add("express", 2, "express import/require found");
  if (anyContent(/express\s*\.\s*Router\s*\(/))
    add("express", 2, "express.Router() usage found");
  if (anyContent(/\.(get|post|put|patch|delete)\s*\(\s*['"`]\//))
    add("express", 1, "app/router HTTP verb calls found");

  if (anyContent(/from\s+fastapi\s+import|import\s+fastapi\b/))
    add("fastapi", 2, "fastapi import found");
  if (anyContent(/@\w+\.(get|post|put|patch|delete)\s*\(/))
    add("fastapi", 2, "FastAPI route decorators found");
  if (anyContent(/APIRouter\s*\(/)) add("fastapi", 1, "APIRouter usage found");
  if (anyContent(/class\s+\w+\s*\(\s*(BaseModel|pydantic\.BaseModel)\s*\)/))
    add("fastapi", 1, "Pydantic models found");

  if (anyContent(/@RestController|@Controller\b/))
    add("spring", 2, "Spring @RestController/@Controller found");
  if (anyContent(/@(Get|Post|Put|Patch|Delete|Request)Mapping\b/))
    add("spring", 2, "Spring mapping annotations found");
  if (anyContent(/import\s+org\.springframework\./))
    add("spring", 1, "Spring imports found");

  const ranked = (["express", "fastapi", "spring"] as Framework[]).sort(
    (a, b) => scores[b] - scores[a]
  );
  const best = ranked[0];
  const bestScore = scores[best];
  const total = scores.express + scores.fastapi + scores.spring;

  if (bestScore <= 0 || total <= 0) {
    return {
      framework: "unknown",
      confidence: 0,
      reason: "No recognized framework signals found in scanned files.",
      signals,
    };
  }
  const confidence = Math.min(1, bestScore / Math.max(4, total));
  if (confidence < 0.34 || bestScore < 2) {
    return {
      framework: "unknown",
      confidence: Number(confidence.toFixed(2)),
      reason:
        "Detection confidence below threshold. Supported frameworks: Express/Node.js, FastAPI/Python, Spring Boot/Java.",
      signals,
    };
  }
  return {
    framework: best,
    confidence: Number(confidence.toFixed(2)),
    reason: `Strongest signals point to ${best} (${bestScore} pts).`,
    signals,
  };
}

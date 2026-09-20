/**
 * API Sentinel — analysis pipeline.
 * REPO → DETECT → SCAN → PARSE → EXTRACT → COMPARE → RISK → IMPACT →
 * AI → PATCH → VALIDATE → PUBLISH → DOCS → NOTIFY → AUDIT
 *
 * Every stage reports real state to the persisted AnalysisRun so the UI
 * can show actual progress (never fake loading).
 */
import type {
  AnalysisRun,
  AnalysisStatus,
  ApiChange,
  EndpointContract,
  OpenApiVersion,
  PipelineStage,
  Repository,
  ValidationResult,
} from "./types";
import {
  addHistory,
  getAnalysis,
  getEndpoints,
  getRepo,
  getSnapshot,
  latestOpenApi,
  listAnalyses,
  nowIso,
  saveAnalysis,
  saveEndpoints,
  saveRepo,
  saveSnapshot,
  store,
  uid,
} from "@/db/store";
import { log } from "./logging";
import { planScan, type ScanPlan } from "./parsers";
import {
  emptyParseCache,
  extractIncremental,
  type ParseCache,
} from "./parsers/incremental";
import { diffContracts } from "./diff/engine";
import { analyzeImpact } from "./impact/analyzer";
import { parseSpec } from "./openapi/reader";
import { buildFreshSpec, patchSpec, previewPatch } from "./openapi/writer";
import { validateSpec } from "./openapi/validator";
import {
  compareCommits,
  downloadTarball,
  getBranchSha,
  resolveGitHubToken,
} from "./git/github";
import { extractTarGz } from "./git/tarball";
import { demoChangedFiles, demoFiles, DEMO_REPOS, nextDemoVersion } from "./demo";
import { askSentinel, buildContext } from "./agent/orchestrator";
import {
  notifyBreakingChanges,
  notifyPublished,
  notifyValidationFailed,
} from "./notifications/center";

const STAGES: AnalysisStatus[] = [
  "queued",
  "fetching",
  "scanning",
  "parsing",
  "extracting",
  "comparing",
  "impact-analysis",
  "ai-analysis",
  "generating",
  "validating",
  "publishing",
  "completed",
];

// ---- run locking (one active analysis per repo) ----------------------------

const activeRuns = new Map<string, string>(); // repoId -> runId

export function activeRunFor(repoId: string): string | null {
  return activeRuns.get(repoId) ?? null;
}

// ---- stage helpers ----------------------------------------------------------

function initStages(): PipelineStage[] {
  return STAGES.filter((s) => s !== "completed").map((stage) => ({
    stage,
    status: stage === "queued" ? "running" : "pending",
  }));
}

function setStage(run: AnalysisRun, stage: string, status: PipelineStage["status"], detail?: string) {
  const s = run.stages.find((x) => x.stage === stage);
  if (s) {
    s.status = status;
    if (status === "running") s.startedAt = nowIso();
    if (status === "done" || status === "failed" || status === "skipped") s.endedAt = nowIso();
    if (detail !== undefined) s.detail = detail;
  }
  const order = STAGES;
  const idx = order.indexOf(stage as AnalysisStatus);
  if (idx >= 0 && (status === "running" || status === "done")) {
    run.status = stage as AnalysisStatus;
  }
  saveAnalysis(run);
}

function hist(repoId: string, analysisId: string, kind: string, actor: string, message: string, meta?: Record<string, unknown>) {
  addHistory({ id: uid("hist"), repoId, analysisId, kind, actor, message, meta, createdAt: nowIso() });
}

// ---- file sources ------------------------------------------------------------

export interface FetchedRepo {
  files: Map<string, string>;
  headSha: string;
  baseSha: string | null;
  compareChanged: string[] | null;
  fetchNotes: string[];
}

async function fetchDemoFiles(
  repo: Repository,
  prevSha: string | null,
  opts: { fullRescan?: boolean; headSha?: string }
): Promise<FetchedRepo> {
  const key = repo.id;
  const headSha = opts.headSha ?? (opts.fullRescan && prevSha ? prevSha : nextDemoVersion(key, prevSha));
  const files = demoFiles(key, headSha);
  if (!files) throw new Error(`Demo fixture missing for ${key}@${headSha}.`);
  const baseSha = prevSha && prevSha !== headSha ? prevSha : prevSha;
  const compareChanged =
    baseSha && baseSha !== headSha ? demoChangedFiles(key, baseSha, headSha) : [];
  return {
    files,
    headSha,
    baseSha,
    compareChanged,
    fetchNotes: [`demo fixture ${key}@${headSha}`],
  };
}

async function fetchGitHubFiles(
  repo: Repository,
  prevSha: string | null,
  opts: { fullRescan?: boolean; headSha?: string; baseSha?: string; branch?: string }
): Promise<FetchedRepo> {
  const token = resolveGitHubToken(store.getSetting("githubToken"));
  const cfg = { token };
  const branch = opts.branch || repo.defaultBranch;
  let headSha = opts.headSha ?? "";
  if (!/^[0-9a-f]{40}$/i.test(headSha)) {
    headSha = await getBranchSha(repo.owner, repo.repo, headSha || branch, cfg);
  }
  const baseSha = opts.baseSha ?? prevSha ?? null;
  let compareChanged: string[] | null = null;
  const notes: string[] = [];
  if (baseSha && baseSha !== headSha && !opts.fullRescan) {
    try {
      const cmp = await compareCommits(repo.owner, repo.repo, baseSha, headSha, cfg);
      compareChanged = cmp.changedFiles.map((f) => f.filename);
      notes.push(`compare ${baseSha.slice(0, 7)}...${headSha.slice(0, 7)}: ${compareChanged.length} changed files`);
      if (cmp.truncated) notes.push("compare result truncated by GitHub (300 file cap)");
    } catch (err) {
      notes.push(`compare API unavailable (${err instanceof Error ? err.message : String(err)}); full snapshot diff`);
    }
  } else if (!baseSha) {
    notes.push("first scan: full repository snapshot");
  }
  const { bytes } = await downloadTarball(repo.owner, repo.repo, headSha, cfg);
  const { files, skipped, truncated } = extractTarGz(bytes);
  for (const s of skipped.slice(0, 50)) notes.push(`archive skip: ${s.file} (${s.reason})`);
  if (truncated) notes.push("archive truncated at 5000 files");
  notes.push(`${files.size} files extracted from tarball`);
  return { files, headSha, baseSha, compareChanged, fetchNotes: notes };
}

// ---- main entry ---------------------------------------------------------------

export interface RunAnalysisOpts {
  repoId: string;
  trigger: AnalysisRun["trigger"];
  headSha?: string;
  baseSha?: string;
  branch?: string;
  fullRescan?: boolean;
  actor?: string;
}

export async function runAnalysis(opts: RunAnalysisOpts): Promise<AnalysisRun> {
  const repo = getRepo(opts.repoId);
  if (!repo) throw new Error(`Repository not found: ${opts.repoId}`);
  if (activeRuns.has(repo.id)) {
    const existing = getAnalysis(activeRuns.get(repo.id)!);
    if (existing) return existing;
    activeRuns.delete(repo.id);
  }

  const t0 = Date.now();
  const prevSnapshot = getSnapshot(repo.id) ?? null;
  const isFirstScan = !prevSnapshot;
  const run: AnalysisRun = {
    id: uid("run"),
    repoId: repo.id,
    trigger: opts.trigger,
    status: "queued",
    stages: initStages(),
    changedFiles: [],
    relevantFiles: [],
    ignoredFiles: [],
    endpoints: [],
    changeIds: [],
    startedAt: nowIso(),
  };
  saveAnalysis(run);
  activeRuns.set(repo.id, run.id);
  hist(repo.id, run.id, "analysis-started", opts.actor ?? opts.trigger, `Analysis started (${opts.trigger}${opts.fullRescan ? ", full rescan" : ""}).`);
  log.info("analysis started", { analysisId: run.id, repoId: repo.id });

  try {
    // FETCHING ------------------------------------------------------------
    setStage(run, "queued", "done", "picked up by pipeline");
    setStage(run, "fetching", "running");
    const fetched =
      repo.provider === "demo"
        ? await fetchDemoFiles(repo, prevSnapshot?.sha ?? null, opts)
        : await fetchGitHubFiles(repo, prevSnapshot?.sha ?? null, opts);
    run.baseSha = fetched.baseSha;
    run.headSha = fetched.headSha;
    saveAnalysis(run);
    setStage(run, "fetching", "done", fetched.fetchNotes.join(" · ").slice(0, 400));
    hist(repo.id, run.id, "fetch", "pipeline", `Fetched ${fetched.files.size} files @ ${fetched.headSha.slice(0, 12)}.`, {
      baseSha: fetched.baseSha,
      headSha: fetched.headSha,
    });

    // SCANNING ------------------------------------------------------------
    setStage(run, "scanning", "running");
    const plan: ScanPlan = planScan(fetched.files);
    run.ignoredFiles = plan.ignored.map((i) => ({ file: i.file, reason: i.reason }));
    run.scanLimits = plan.limits;
    saveAnalysis(run);
    setStage(
      run,
      "scanning",
      "done",
      `${plan.limits.filesScanned} scanned · ${plan.limits.apiFilesAnalyzed} API-relevant · ${plan.consumerOnly.size} test/doc (consumers only) · ${plan.ignored.length} ignored`
    );

    // PARSING (incremental) ------------------------------------------------
    setStage(run, "parsing", "running");
    const prevCache = (prevSnapshot?.parseCache as unknown as ParseCache | null) ?? null;
    const forceFull = isFirstScan || opts.fullRescan === true;
    const inc = extractIncremental(plan, prevCache ?? emptyParseCache(), { forceFull });
    run.framework = inc.framework;
    run.relevantFiles = inc.contributingFiles;
    run.endpoints = inc.endpoints;
    saveAnalysis(run);
    setStage(
      run,
      "parsing",
      "done",
      forceFull
        ? `full parse: ${inc.reparsed.length} files → ${inc.endpoints.length} endpoints`
        : `incremental: ${inc.reparsed.length} re-parsed · ${inc.reused.length} reused from cache → ${inc.endpoints.length} endpoints`
    );

    // changed files for display: compare API wins, else sha-diff of parse cache
    const shaChanged = [...inc.reparsed, ...inc.deleted];
    run.changedFiles = fetched.compareChanged ?? (prevCache ? shaChanged : inc.reparsed);
    if (!prevCache) run.changedFiles = inc.reparsed; // first scan baseline
    saveAnalysis(run);

    // EXTRACTING (normalization checkpoint — contracts already normalized) --
    setStage(run, "extracting", "running");
    const prevEndpoints: EndpointContract[] = prevSnapshot?.endpoints ?? [];
    run.previousEndpointCount = prevEndpoints.length;
    setStage(run, "extracting", "done", `${inc.endpoints.length} normalized contracts (framework: ${inc.framework.framework}, confidence ${inc.framework.confidence})`);
    saveAnalysis(run);

    // COMPARING + RISK ------------------------------------------------------
    setStage(run, "comparing", "running");
    let changes: ApiChange[];
    if (isFirstScan) {
      changes = []; // baseline establishment, not a diff event
    } else {
      changes = diffContracts(prevEndpoints, inc.endpoints);
    }
    for (const c of changes) store.insert("changes", c);
    run.changeIds = changes.map((c) => c.id);
    saveAnalysis(run);
    const crit = changes.filter((c) => c.severity === "CRITICAL").length;
    const high = changes.filter((c) => c.severity === "HIGH").length;
    setStage(
      run,
      "comparing",
      "done",
      isFirstScan ? `baseline established (${inc.endpoints.length} endpoints)` : `${changes.length} changes (${crit} critical, ${high} high)`
    );
    hist(repo.id, run.id, "diff", "diff-engine", isFirstScan ? `Baseline: ${inc.endpoints.length} endpoints.` : `${changes.length} API changes detected.`, {
      changeIds: run.changeIds,
    });

    // IMPACT ----------------------------------------------------------------
    setStage(run, "impact-analysis", "running");
    const impact = changes.length ? analyzeImpact(changes, fetched.files) : [];
    for (const f of impact) store.insert("impact", f);
    setStage(run, "impact-analysis", "done", `${impact.length} consumer references found`);
    saveAnalysis(run);

    // AI --------------------------------------------------------------------
    setStage(run, "ai-analysis", "running");
    try {
      const ctx = buildContext(repo.id, run.id);
      // buildContext reads persisted stores; this run's rows are fresher.
      ctx.endpoints = run.endpoints;
      ctx.changes = [...changes];
      const answer = changes.length
        ? await askSentinel(
            `Summarize this analysis run for the owning engineer: what changed, the highest risk, and the single most important next step.`,
            ctx
          )
        : await askSentinel(`Summarize the current API state in two sentences.`, ctx);
      run.aiSummary = answer.answer.slice(0, 3000);
      run.aiProvider = `${answer.providerKind}:${answer.provider}`;
      setStage(run, "ai-analysis", "done", `provider=${run.aiProvider} · ${answer.latencyMs}ms`);
    } catch (err) {
      run.aiSummary = "AI explanation unavailable for this run.";
      run.aiProvider = "deterministic:unavailable";
      setStage(run, "ai-analysis", "done", `AI unavailable (${err instanceof Error ? err.message : String(err)})`);
    }
    saveAnalysis(run);

    // GENERATING (OpenAPI base + patch set) ----------------------------------
    setStage(run, "generating", "running");
    const baseDoc = resolveBaseDoc(plan, repo);
    const policy = repo.autoSyncPolicy;
    const changeObjs = changes;
    let idsToSync: Set<string>;
    let allowDelete = false;
    if (isFirstScan) {
      idsToSync = new Set(inc.endpoints.map((e) => e.id)); // baseline publish
      allowDelete = false;
    } else if (policy === "auto-all") {
      idsToSync = new Set(changeObjs.flatMap((c) => endpointIdsForChange(c)));
      allowDelete = true;
    } else if (policy === "auto-safe") {
      const safe = changeObjs.filter(
        (c) =>
          (c.breaking === "non-breaking" || c.severity === "LOW") &&
          c.type !== "DELETED_ENDPOINT" &&
          c.type !== "METHOD_CHANGED"
      );
      idsToSync = new Set(safe.flatMap((c) => endpointIdsForChange(c)));
      allowDelete = false;
    } else {
      idsToSync = new Set(); // manual: approval workflow decides
    }
    const patch = patchSpec(baseDoc.doc, inc.endpoints, { idsToSync, allowDelete });
    setStage(
      run,
      "generating",
      "done",
      `base=${baseDoc.source} · policy=${policy} · +${patch.added.length} ~${patch.patched.length} -${patch.removed.length}`
    );
    saveAnalysis(run);

    // VALIDATING ---------------------------------------------------------------
    setStage(run, "validating", "running");
    const strict = store.getSetting("openapiStrictness") === "strict";
    const validation: ValidationResult = await validateSpec(patch.doc, { strict });
    run.validation = validation;
    saveAnalysis(run);
    if (!validation.valid) {
      setStage(run, "validating", "failed", `${validation.errors.length} errors — publish blocked`);
      hist(repo.id, run.id, "validation-failed", "openapi-validator", `Spec rejected: ${validation.errors[0]?.message ?? "unknown"}.`);
      notifyValidationFailed(repo, run, validation.errors);
    } else {
      setStage(run, "validating", "done", `PASSED · ${validation.operations} ops · ${validation.warnings.length} warnings`);
    }

    // PUBLISHING ---------------------------------------------------------------
    setStage(run, "publishing", "running");
    if (validation.valid && (idsToSync.size > 0 || isFirstScan)) {
      const version = publishSpec(repo, run, patch.doc, validation, isFirstScan ? "generated" : "patched", [...idsToSync]);
      for (const c of changeObjs) {
        const ids = endpointIdsForChange(c);
        if (ids.every((id) => idsToSync.has(id))) {
          store.updateById("changes", c.id, { synced: true });
        }
      }
      notifyPublished(repo, run, version, validation.operations);
      setStage(run, "publishing", "done", `published v${version} · ${validation.operations} ops`);
      hist(repo.id, run.id, "published", "pipeline", `OpenAPI v${version} published (${validation.operations} operations).`);
    } else if (validation.valid && changeObjs.length > 0) {
      // manual policy: create a pending approval with a real preview
      const fullPatch = patchSpec(baseDoc.doc, inc.endpoints, {
        idsToSync: new Set(changeObjs.flatMap((c) => endpointIdsForChange(c))),
        allowDelete: true,
      });
      const fullValidation = await validateSpec(fullPatch.doc, { strict });
      const preview = previewPatch(baseDoc.doc, fullPatch.doc);
      store.insert("approvals", {
        id: uid("appr"),
        repoId: repo.id,
        analysisId: run.id,
        changeIds: changeObjs.map((c) => c.id),
        status: "pending",
        patchPreview: `source=${baseDoc.source} validation=${fullValidation.valid ? "PASSED" : "FAILED"}\n${preview}`,
        createdAt: nowIso(),
      });
      setStage(run, "publishing", "skipped", "manual policy: approval required before publish");
      hist(repo.id, run.id, "approval-required", "pipeline", "Manual sync policy: patch preview ready for review.");
    } else {
      setStage(run, "publishing", "skipped", isFirstScan ? "baseline recorded" : "nothing selected to publish");
    }

    // persist state -------------------------------------------------------------
    saveEndpoints(repo.id, inc.endpoints);
    saveSnapshot({
      repoId: repo.id,
      sha: fetched.headSha,
      files: inc.endpoints.map((e) => ({ file: e.sourceFile, sha: "", endpoints: [e], framework: e.framework })),
      endpoints: inc.endpoints,
      updatedAt: nowIso(),
      parseCache: {
        fileSha: inc.cache.fileSha,
        express: inc.cache.express as unknown as Record<string, unknown>,
        fastapi: inc.cache.fastapi as unknown as Record<string, unknown>,
        spring: inc.cache.spring as unknown as Record<string, unknown>,
      },
    });
    repo.lastSha = fetched.headSha;
    repo.lastAnalysisId = run.id;
    repo.status = "connected";
    repo.statusMessage = undefined;
    repo.updatedAt = nowIso();
    saveRepo(repo);

    if (changes.length) {
      notifyBreakingChanges(repo, run, changes);
    }

    run.status = "completed";
    run.finishedAt = nowIso();
    run.durationMs = Date.now() - t0;
    const completed = run.stages.find((s) => s.stage === "completed");
    void completed;
    saveAnalysis(run);
    hist(repo.id, run.id, "analysis-completed", "pipeline", `Analysis completed in ${run.durationMs}ms.`, {
      durationMs: run.durationMs,
      changes: changes.length,
    });
    log.info("analysis completed", {
      analysisId: run.id,
      repoId: repo.id,
      commitSha: fetched.headSha,
      durationMs: run.durationMs,
      result: "completed",
    });
    return run;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    run.status = "failed";
    run.error = message.slice(0, 1000);
    run.finishedAt = nowIso();
    run.durationMs = Date.now() - t0;
    for (const s of run.stages) {
      if (s.status === "running" || s.status === "pending") {
        s.status = "failed";
        s.endedAt = nowIso();
      }
    }
    saveAnalysis(run);
    const repoRow = getRepo(repo.id);
    if (repoRow) {
      repoRow.status = "error";
      repoRow.statusMessage = message.slice(0, 300);
      repoRow.updatedAt = nowIso();
      saveRepo(repoRow);
    }
    hist(repo.id, run.id, "analysis-failed", "pipeline", `Analysis failed: ${message.slice(0, 300)}`);
    log.error("analysis failed", { analysisId: run.id, repoId: repo.id, result: "failed" });
    return run;
  } finally {
    if (activeRuns.get(repo.id) === run.id) activeRuns.delete(repo.id);
  }
}

function endpointIdsForChange(c: ApiChange): string[] {
  const ids = new Set<string>();
  if (c.after) ids.add(c.after.id);
  else if (c.before) ids.add(c.before.id);
  else ids.add(`${c.method} ${c.path}`);
  return [...ids];
}

function resolveBaseDoc(plan: ScanPlan, repo: Repository): { doc: Record<string, unknown>; source: string } {
  // 1) repo's own OpenAPI file (parsed fresh this run)
  if (plan.openapiFiles.length) {
    try {
      const parsed = parseSpec(plan.openapiFiles[0].content);
      return { doc: parsed.doc, source: `repo:${plan.openapiFiles[0].file}` };
    } catch {
      /* fall through to last published */
    }
  }
  // 2) last published version
  const last = latestOpenApi(repo.id);
  if (last) {
    return {
      doc: JSON.parse(JSON.stringify(last.spec)) as Record<string, unknown>,
      source: `published:v${last.version}`,
    };
  }
  // 3) fresh skeleton
  return {
    doc: buildFreshSpec(`${repo.owner}/${repo.repo} API`, []),
    source: "fresh",
  };
}

function publishSpec(
  repo: Repository,
  run: AnalysisRun,
  doc: Record<string, unknown>,
  validation: ValidationResult,
  source: OpenApiVersion["source"],
  changeIds: string[]
): number {
  const last = latestOpenApi(repo.id);
  const version = (last?.version ?? 0) + 1;
  const specJson = JSON.stringify(doc);
  const row: OpenApiVersion = {
    id: uid("oas"),
    repoId: repo.id,
    version,
    spec: JSON.parse(specJson) as Record<string, unknown>,
    specJson,
    validation,
    source,
    analysisId: run.id,
    changeIds,
    createdAt: nowIso(),
  };
  store.insert("openapi", row);
  return version;
}

// ---- approval workflow ---------------------------------------------------------

export interface SyncPreview {
  changeIds: string[];
  added: string[];
  patched: string[];
  removed: string[];
  skipped: { id: string; reason: string }[];
  validation: ValidationResult;
  preview: string;
  baseSource: string;
}

export async function previewSync(
  repoId: string,
  changeIds: string[],
  allowDelete: boolean
): Promise<SyncPreview> {
  const repo = getRepo(repoId);
  if (!repo) throw new Error("Repository not found.");
  const endpoints = getEndpoints(repoId);
  const last = latestOpenApi(repoId);
  const baseDoc = last
    ? (JSON.parse(JSON.stringify(last.spec)) as Record<string, unknown>)
    : buildFreshSpec(`${repo.owner}/${repo.repo} API`, []);
  const baseSource = last ? `published:v${last.version}` : "fresh";
  const allChanges = store.all("changes");
  const wanted = new Set(allChanges.filter((c) => changeIds.includes(c.id)).flatMap(endpointIdsForChange));
  const patch = patchSpec(baseDoc, endpoints, { idsToSync: wanted, allowDelete });
  const strict = store.getSetting("openapiStrictness") === "strict";
  const validation = await validateSpec(patch.doc, { strict });
  return {
    changeIds,
    added: patch.added,
    patched: patch.patched,
    removed: patch.removed,
    skipped: patch.skipped,
    validation,
    preview: previewPatch(baseDoc, patch.doc),
    baseSource,
  };
}

export async function applySync(
  repoId: string,
  changeIds: string[],
  allowDelete: boolean,
  actor: string
): Promise<{ version: number; validation: ValidationResult }> {
  const repo = getRepo(repoId);
  if (!repo) throw new Error("Repository not found.");
  const endpoints = getEndpoints(repoId);
  const last = latestOpenApi(repoId);
  const baseDoc = last
    ? (JSON.parse(JSON.stringify(last.spec)) as Record<string, unknown>)
    : buildFreshSpec(`${repo.owner}/${repo.repo} API`, []);
  const allChanges = store.all("changes");
  const wanted = new Set(allChanges.filter((c) => changeIds.includes(c.id)).flatMap(endpointIdsForChange));
  const patch = patchSpec(baseDoc, endpoints, { idsToSync: wanted, allowDelete });
  const strict = store.getSetting("openapiStrictness") === "strict";
  const validation = await validateSpec(patch.doc, { strict });
  if (!validation.valid) {
    hist(repoId, "", "sync-rejected", actor, `Sync rejected: ${validation.errors[0]?.message ?? "invalid spec"}.`);
    throw new Error(
      `Sync rejected — generated spec is INVALID: ${validation.errors[0]?.message ?? "unknown error"}. Nothing was published.`
    );
  }
  const version = publishSpec(
    repo,
    { id: `manual_${Date.now()}`, repoId } as AnalysisRun,
    patch.doc,
    validation,
    "patched",
    changeIds
  );
  for (const id of changeIds) store.updateById("changes", id, { synced: true });
  const approvals = store.all("approvals").filter((a) => a.repoId === repoId && a.status === "pending");
  for (const a of approvals) {
    if (a.changeIds.every((id) => changeIds.includes(id))) {
      store.updateById("approvals", a.id, { status: "approved", decidedAt: nowIso() });
    }
  }
  hist(repoId, "", "published", actor, `Manual sync published OpenAPI v${version} (${changeIds.length} changes).`);
  const run = listAnalyses(repoId)[0];
  if (run) notifyPublished(repo, run, version, validation.operations);
  return { version, validation };
}

// ---- demo helpers -----------------------------------------------------------------

export function ensureDemoRepos(): Repository[] {
  const out: Repository[] = [];
  for (const def of DEMO_REPOS) {
    let repo = getRepo(def.key);
    if (!repo) {
      repo = {
        id: def.key,
        name: def.name,
        owner: def.owner,
        repo: def.repo,
        url: `https://github.com/${def.owner}/${def.repo}`,
        defaultBranch: def.defaultBranch,
        provider: "demo",
        status: "disconnected",
        lastSha: null,
        lastAnalysisId: null,
        webhookEnabled: false,
        webhookSecretSet: false,
        autoSyncPolicy: "manual",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      const rows = store.all("repositories");
      rows.push(repo);
      store.replace("repositories", rows);
      hist(repo.id, "", "repo-connected", "demo", `Demo repository '${def.name}' registered.`);
    }
    out.push(repo);
  }
  return out;
}

/** Reset a repo to its pre-analysis state (demo reset). */
export function resetRepoData(repoId: string): void {
  // Collect this repo's change ids BEFORE deleting its analyses.
  const doomed = new Set<string>();
  for (const a of store.all("analyses")) {
    if (a.repoId === repoId) for (const id of a.changeIds) doomed.add(id);
  }
  store.replace("analyses", store.all("analyses").filter((a) => a.repoId !== repoId));
  if (doomed.size) {
    store.replace("changes", store.all("changes").filter((c) => !doomed.has(c.id)));
    store.replace("impact", store.all("impact").filter((i) => !doomed.has(i.changeId)));
  }
  store.replace("endpoints", store.all("endpoints").filter((e) => e.repoId !== repoId));
  store.replace("openapi", store.all("openapi").filter((o) => o.repoId !== repoId));
  store.replace("snapshots", store.all("snapshots").filter((s) => s.repoId !== repoId));
  store.replace("approvals", store.all("approvals").filter((a) => a.repoId !== repoId));
  store.replace("notifications", store.all("notifications").filter((n) => n.repoId !== repoId));
  // Global history is append-only (audit trail); everything else repo-scoped
  // above is removed so the UI shows a genuinely fresh state.
  const repo = getRepo(repoId);
  if (repo) {
    repo.lastSha = null;
    repo.lastAnalysisId = null;
    repo.status = "disconnected";
    repo.statusMessage = undefined;
    repo.updatedAt = nowIso();
    saveRepo(repo);
  }
  if (repo) hist(repoId, "", "repo-reset", "demo", `Repository '${repo.name}' was reset.`);
}

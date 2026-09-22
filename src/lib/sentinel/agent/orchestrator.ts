/**
 * Agent orchestrator: builds grounded context, selects the provider
 * (local -> remote -> deterministic), and guarantees an answer even when
 * every model is unreachable.
 */
import type {
  AgentAnswer,
  ApiChange,
  HealthScore,
  ProviderStatus,
  SentinelContext,
} from "../types";
import {
  getAnalysis,
  getChange,
  getEndpoints,
  getRepo,
  latestOpenApi,
  listAnalyses,
  listChanges,
  listHistory,
  store,
} from "@/db/store";
import { coverageOf } from "../openapi/reader";
import type { AIProvider } from "./providers";
import { DeterministicProvider } from "./deterministic";
import { LocalAIProvider, RemoteAIProvider } from "./remote";

export function computeHealth(
  repoId: string,
  endpointsCount: number,
  documented: number,
  outOfSync: number,
  breakingOpen: number,
  validation: "PASSED" | "FAILED" | "UNKNOWN",
  lastSyncAt?: string
): HealthScore {
  void repoId;
  let score = 100;
  if (endpointsCount > 0) {
    const undocumented = endpointsCount - documented;
    score -= Math.round((undocumented / endpointsCount) * 45);
  }
  score -= Math.min(25, outOfSync * 8);
  score -= Math.min(20, breakingOpen * 10);
  if (validation === "FAILED") score -= 15;
  if (validation === "UNKNOWN" && endpointsCount > 0) score -= 5;
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    documented,
    totalEndpoints: endpointsCount,
    outOfSync,
    breakingOpen,
    validation,
    lastSyncAt,
    breakdown: [
      { label: "Endpoints documented", value: `${documented}/${endpointsCount}`, ok: documented === endpointsCount },
      { label: "Out of sync", value: String(outOfSync), ok: outOfSync === 0 },
      { label: "Breaking-risk open", value: String(breakingOpen), ok: breakingOpen === 0 },
      { label: "Validation", value: validation, ok: validation === "PASSED" },
    ],
  };
}

export function buildContext(repoId?: string, analysisId?: string): SentinelContext {
  const repo = repoId ? getRepo(repoId) : undefined;
  const rid = repo?.id;
  const analyses = rid ? listAnalyses(rid) : listAnalyses();
  const analysis = analysisId
    ? getAnalysis(analysisId) ?? null
    : (analyses[0] ?? null);
  const endpoints = rid ? getEndpoints(rid) : [];
  const allChanges = listChanges();
  const sevRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const changes = (
    analysis
      ? allChanges.filter((c) => analysis.changeIds.includes(c.id))
      : allChanges.slice(0, 50)
  ).sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));
  const openapi = rid ? (latestOpenApi(rid) ?? null) : null;
  // The published spec's validation is the freshest statement about what is
  // live; fall back to the run's own validation when nothing is published.
  const validation = openapi?.validation ?? analysis?.validation ?? null;
  const impact = store
    .all("impact")
    .filter((i) => changes.some((c) => c.id === i.changeId));
  const history = listHistory(rid).slice(0, 30);

  let health: HealthScore | undefined;
  if (rid) {
    let documented = 0;
    if (openapi) {
      documented = coverageOf(openapi.spec, endpoints).documented;
    }
    const outOfSync = changes.filter((c) => !c.synced).length;
    const breakingOpen = changes.filter(
      (c) => !c.synced && (c.breaking === "likely-breaking" || c.severity === "HIGH" || c.severity === "CRITICAL")
    ).length;
    health = computeHealth(
      rid,
      endpoints.length,
      documented,
      outOfSync,
      breakingOpen,
      validation ? (validation.valid ? "PASSED" : "FAILED") : "UNKNOWN",
      openapi?.createdAt
    );
  }

  return { repo, analysis, endpoints, changes, openapi, validation, impact, health, history };
}

export type ProviderPreference = "auto" | "local" | "remote" | "deterministic";

export function providerPreference(): ProviderPreference {
  const p = (store.getSetting("aiProviderPreference") ||
    process.env.SENTINEL_AI_PROVIDER ||
    "auto") as ProviderPreference;
  return ["auto", "local", "remote", "deterministic"].includes(p) ? p : "auto";
}

export function buildProviders(): AIProvider[] {
  const local = new LocalAIProvider({
    baseUrl:
      store.getSetting("localAiUrl") || process.env.SENTINEL_LOCAL_AI_URL || undefined,
    model:
      store.getSetting("localAiModel") || process.env.SENTINEL_LOCAL_AI_MODEL || undefined,
  });
  const remote = new RemoteAIProvider();
  const deterministic = new DeterministicProvider();
  const pref = providerPreference();
  if (pref === "local") return [local, deterministic];
  if (pref === "remote") return [remote, deterministic];
  if (pref === "deterministic") return [deterministic];
  return [local, remote, deterministic];
}

export async function providerStatuses(): Promise<{
  statuses: ProviderStatus[];
  active: string;
}> {
  const providers = buildProviders();
  const statuses = await Promise.all(providers.map((p) => p.status()));
  const active =
    statuses.find((s) => s.connected)?.id ?? "deterministic";
  return { statuses, active };
}

async function withFallback<T>(
  providers: AIProvider[],
  fn: (p: AIProvider) => Promise<T>
): Promise<{ result: T; provider: AIProvider }> {
  let lastErr: unknown = null;
  for (const p of providers) {
    try {
      const st = await p.status();
      if (!st.connected) continue;
      const result = await fn(p);
      return { result, provider: p };
    } catch (err) {
      lastErr = err;
    }
  }
  // Absolute guarantee: deterministic provider never fails.
  const det = new DeterministicProvider();
  void lastErr;
  return { result: await fn(det), provider: det };
}

export async function askSentinel(
  question: string,
  ctx: SentinelContext,
  imageDataUrl?: string
): Promise<AgentAnswer> {
  const t0 = Date.now();
  const providers = buildProviders();
  const { result, provider } = await withFallback(providers, (p) =>
    p.answerQuestion(question, ctx, imageDataUrl)
  );
  return {
    ...result,
    provider: provider.id,
    providerKind: provider.kind,
    latencyMs: Date.now() - t0,
  };
}

export async function explainChange(
  changeId: string,
  ctx: SentinelContext
): Promise<{ text: string; provider: string; kind: string }> {
  const change = getChange(changeId);
  if (!change) throw new Error("Change not found.");
  const providers = buildProviders();
  const { result, provider } = await withFallback(providers, (p) =>
    p.explainChange(change, ctx)
  );
  return { text: result, provider: provider.id, kind: provider.kind };
}

export async function migrationFor(
  change: ApiChange,
  ctx: SentinelContext
): Promise<{ text: string; provider: string; kind: string }> {
  const providers = buildProviders();
  const { result, provider } = await withFallback(providers, (p) =>
    p.generateMigration(change, ctx)
  );
  return { text: result, provider: provider.id, kind: provider.kind };
}

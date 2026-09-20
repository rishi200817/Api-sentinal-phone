/** Dashboard overview: deep analysis surface for the selected repo. */
"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { get, post, shortSha, timeAgo } from "@/lib/client";
import { RepoPicker, useRepos } from "@/components/repo-context";
import {
  Badge, BreakingBadge, Empty, HealthRing, LiveDot, MethodTag,
  RichText, SeverityBadge, Spinner, StageTimeline,
} from "@/components/ui";

interface OverviewData {
  repo: { id: string; name: string; status: string; statusMessage?: string; lastSha: string | null; autoSyncPolicy: string } | null;
  health: { score: number; documented: number; totalEndpoints: number; outOfSync: number; breakingOpen: number; validation: string; lastSyncAt?: string; breakdown: { label: string; value: string; ok: boolean }[] } | null;
  latestRun: {
    id: string; status: string; trigger: string; startedAt: string; finishedAt?: string; durationMs?: number;
    baseSha?: string | null; headSha?: string | null; stages: { stage: string; status: string; detail?: string }[];
    framework?: { framework: string; confidence: number; reason: string };
    scanLimits?: { filesScanned: number; apiFilesAnalyzed: number };
    changedFiles: string[]; relevantFiles: string[];
    aiSummary?: string; aiProvider?: string; error?: string;
  } | null;
  recentRuns: { id: string; status: string; trigger: string; startedAt: string; durationMs?: number }[];
  endpoints: { id: string; method: string; path: string }[];
  changes: { id: string; type: string; severity: string; breaking: string; method: string; path: string; detail: string; synced: boolean }[];
  validation: { valid: boolean; operations: number; errors: { path: string; message: string }[]; warnings: { path: string; message: string }[]; engine: string[] } | null;
  openapiVersion: number | null;
  approvals: { id: string; changeIds: string[]; createdAt: string }[];
  webhooks: { id: string; event: string; valid: boolean; branch?: string; afterSha?: string; receivedAt: string; analysisId?: string }[];
  notifications: { id: string; kind: string; title: string; body: string; createdAt: string }[];
  unread: number;
  aiSummary: string | null;
  aiProvider: string | null;
}

function OverviewInner() {
  const { selectedId, selected } = useRepos();
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!selectedId) return;
    try {
      setData(await get<OverviewData>(`/api/overview?repoId=${encodeURIComponent(selectedId)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }, [selectedId]);

  useEffect(() => { void load(); }, [load]);

  // Poll while a run is active so progress is REAL backend state.
  useEffect(() => {
    const active = data?.latestRun && !["completed", "failed"].includes(data.latestRun.status);
    if (active) {
      setAnalyzing(true);
      timer.current = setInterval(load, 2000);
    } else {
      setAnalyzing(false);
      if (timer.current) clearInterval(timer.current);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [data?.latestRun?.status, load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function analyze(fullRescan: boolean) {
    if (!selectedId) return;
    setError("");
    try {
      await post(`/api/repos/${selectedId}/analyze`, { fullRescan });
      setAnalyzing(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed to start.");
    }
  }

  const run = data?.latestRun ?? null;
  return (
    <div className="shell">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>Deep analysis for the selected repository. Every number is computed from backend state.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <RepoPicker />
          {data?.repo && (
            <LiveDot status={data.repo.status === "connected" ? "live" : data.repo.status === "error" ? "warn" : "off"} label={data.repo.status.toUpperCase()} />
          )}
        </div>
      </div>

      {error && <div className="alert red">{error}</div>}
      {!selected && <div className="card"><Empty icon="◌" title="No repository selected" hint="Connect GitHub or load the demo repositories first." /></div>}

      {data?.repo?.status === "error" && (
        <div className="alert amber"><strong>Repository error:</strong> {data.repo.statusMessage ?? "unknown"}</div>
      )}

      {selected && data && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn primary" onClick={() => analyze(false)} disabled={analyzing}>
                {analyzing ? <><Spinner /> Analyzing… ({run?.status})</> : "Analyze now"}
              </button>
              <button className="btn" onClick={() => analyze(true)} disabled={analyzing}>Full rescan</button>
              <span className="muted" style={{ fontSize: 12 }}>
                auto-sync policy: <strong>{data.repo?.autoSyncPolicy}</strong> · HEAD {shortSha(data.repo?.lastSha)}
              </span>
              {selected?.provider === "demo" && (
                <button
                  className="btn small"
                  disabled={analyzing}
                  onClick={async () => {
                    try { await post("/api/demo/push", { repoId: selectedId }); await load(); }
                    catch (e) { setError(e instanceof Error ? e.message : "Demo push failed."); }
                  }}
                >
                  Simulate GitHub push
                </button>
              )}
            </div>
          </div>

          <div className="grid cols-4">
            <div className="card" style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <HealthRing score={data.health?.score ?? 0} />
              <div>
                <div className="kpi-label">Doc health</div>
                <div className="mono" style={{ fontSize: 12, marginTop: 4 }}>
                  {data.health?.documented ?? 0}/{data.health?.totalEndpoints ?? 0} documented
                </div>
                <div className="mono" style={{ fontSize: 12 }}>{data.health?.outOfSync ?? 0} out of sync</div>
              </div>
            </div>
            <div className="card">
              <div className="kpi-label">Endpoints</div>
              <div className="kpi">{data.endpoints.length}</div>
              <div className="muted" style={{ fontSize: 12 }}>normalized contracts</div>
            </div>
            <div className="card">
              <div className="kpi-label">Open changes</div>
              <div className="kpi">{data.changes.length}</div>
              <div className="muted" style={{ fontSize: 12 }}>{data.health?.breakingOpen ?? 0} breaking-risk</div>
            </div>
            <div className="card">
              <div className="kpi-label">OpenAPI v{data.openapiVersion ?? "—"}</div>
              <div style={{ marginTop: 10 }}>
                {data.validation
                  ? data.validation.valid
                    ? <Badge tone="green">VALID · {data.validation.operations} ops</Badge>
                    : <Badge tone="red">INVALID · {data.validation.errors.length} errors</Badge>
                  : <Badge>no spec yet</Badge>}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {data.validation ? `via ${data.validation.engine.join(" + ")}` : "run an analysis"}
              </div>
            </div>
          </div>

          {data.approvals.length > 0 && (
            <div className="alert amber" style={{ marginTop: 14 }}>
              <strong>{data.approvals.length} pending approval{data.approvals.length > 1 ? "s" : ""}</strong> — risky changes are waiting for review before docs sync.{" "}
              <Link href={`/dashboard/documentation?repo=${selectedId}`} style={{ textDecoration: "underline" }}>Review now</Link>
            </div>
          )}

          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <div className="card">
              <h3>LATEST ANALYSIS <span className="sub">{run ? `${run.trigger} · ${timeAgo(run.startedAt)}` : "none yet"}</span></h3>
              {!run && <Empty icon="◇" title="No analysis runs" hint="Click “Analyze now” to scan this repository." />}
              {run && (
                <>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    <Badge tone={run.status === "completed" ? "green" : run.status === "failed" ? "red" : "cyan"}>{run.status}</Badge>
                    {run.baseSha && <span className="mono muted">{shortSha(run.baseSha)}…{shortSha(run.headSha)}</span>}
                    {run.durationMs != null && <span className="mono muted">{run.durationMs}ms</span>}
                  </div>
                  {run.error && <div className="alert red">{run.error}</div>}
                  <StageTimeline stages={run.stages} />
                  {run.framework && (
                    <p className="muted" style={{ fontSize: 12 }}>
                      Framework: <strong>{run.framework.framework}</strong> (confidence {run.framework.confidence}) — {run.framework.reason}
                    </p>
                  )}
                  {run.scanLimits && (
                    <p className="muted mono" style={{ fontSize: 12 }}>
                      {run.scanLimits.filesScanned} files scanned · {run.scanLimits.apiFilesAnalyzed} API-relevant · 0 repo code executed
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="card">
              <h3>TOP CHANGES</h3>
              {!data.changes.length && <Empty icon="✓" title="No changes" hint="The API surface matches the last snapshot." />}
              {data.changes.slice(0, 5).map((c) => (
                <div key={c.id} style={{ padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <MethodTag method={c.method} /> <span className="mono">{c.path}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    <SeverityBadge severity={c.severity} />
                    <BreakingBadge breaking={c.breaking} />
                    <Badge>{c.type}</Badge>
                    {c.synced ? <Badge tone="green">synced</Badge> : <Badge tone="amber">unsynced</Badge>}
                  </div>
                </div>
              ))}
              {data.changes.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <Link href={`/dashboard/changes?repo=${selectedId}`} className="btn small">All changes</Link>
                </div>
              )}
            </div>
          </div>

          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <div className="card">
              <h3>SENTINEL SUMMARY <span className="sub">{data.aiProvider ? `via ${data.aiProvider}` : ""}</span></h3>
              <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                {data.aiSummary ? <RichText text={data.aiSummary} /> : <span className="muted">No AI summary yet.</span>}
              </div>
            </div>
            <div className="card">
              <h3>RECENT ACTIVITY</h3>
              {data.notifications.length === 0 && <p className="muted">No notifications yet.</p>}
              {data.notifications.map((n) => (
                <div key={n.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                  <strong>{n.title}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>{n.body}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>{timeAgo(n.createdAt)} · {n.kind}</div>
                </div>
              ))}
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <Link href={`/dashboard/activity?repo=${selectedId}`} className="btn small">Audit log</Link>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="shell"><div className="card"><Spinner /> Loading…</div></div>}>
      <OverviewInner />
    </Suspense>
  );
}

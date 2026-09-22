/** Mobile home: status, health, latest alert, quick actions. */
"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { get, post, shortSha, timeAgo } from "@/lib/client";
import { useRepos } from "@/components/repo-context";
import { Badge, BreakingBadge, HealthRing, LiveDot, MethodTag, SeverityBadge, Spinner } from "@/components/ui";
import { usePushAlerts } from "./push";

interface Overview {
  repo: { id: string; name: string; status: string; lastSha: string | null } | null;
  health: { score: number; documented: number; totalEndpoints: number; outOfSync: number; breakingOpen: number; validation: string } | null;
  latestRun: { id: string; status: string; trigger: string; startedAt: string; headSha?: string | null } | null;
  endpoints: { id: string }[];
  changes: { id: string; type: string; severity: string; breaking: string; method: string; path: string; detail: string }[];
  validation: { valid: boolean } | null;
  openapiVersion: number | null;
  aiProvider: string | null;
  unread: number;
}

function MobileHomeInner() {
  const { repos, selected, selectedId, select } = useRepos();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { supported: pushSupported, permission, enable } = usePushAlerts();

  const load = useCallback(async () => {
    if (!selectedId) return;
    try {
      setData(await get<Overview>(`/api/overview?repoId=${selectedId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }, [selectedId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function setupDemo() {
    setBusy(true); setError("");
    try {
      await post("/api/demo/ensure");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Demo setup failed.");
    } finally {
      setBusy(false);
    }
  }

  const alert = data?.changes?.find((c) => c.severity === "CRITICAL" || c.severity === "HIGH") ?? data?.changes?.[0];

  return (
    <div className="mobile-shell">
      <div className="mobile-top">
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span className="brand-mark">S</span>
          <strong>API SENTINEL</strong>
        </div>
        {data?.repo
          ? <LiveDot status={data.repo.status === "connected" ? "live" : "off"} label={data.repo.status === "connected" ? "● LIVE" : "○ IDLE"} />
          : <span className="muted">…</span>}
      </div>

      {error && <div className="alert red">{error}</div>}

      {repos.length > 1 && (
        <select className="select" value={selectedId ?? ""} onChange={(e) => select(e.target.value)} aria-label="Select repository" style={{ marginBottom: 12 }}>
          {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      )}

      {!selected && (
        <div className="sheet">
          <h3 style={{ margin: "0 0 8px" }}>No repository yet</h3>
          <p className="muted" style={{ fontSize: 13 }}>Load the demo to see the full phone workflow.</p>
          <button className="btn primary block" onClick={setupDemo} disabled={busy}>
            {busy ? <Spinner /> : "Load demo"}
          </button>
        </div>
      )}

      {selected && !data && <div className="sheet"><Spinner /> Loading live state…</div>}

      {data?.repo && (
        <>
          <div className="sheet good" style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <HealthRing score={data.health?.score ?? 0} />
            <div>
              <div className="kpi-label">API health</div>
              <div style={{ fontSize: 14, marginTop: 4 }}><strong>{data.endpoints.length}</strong> endpoints</div>
              <div className="muted mono" style={{ fontSize: 12 }}>
                {shortSha(data.latestRun?.headSha ?? data.repo.lastSha)} · {data.latestRun ? timeAgo(data.latestRun.startedAt) : "no runs"}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <Badge tone={data.health && data.health.breakingOpen > 0 ? "red" : "green"}>
                  {data.health?.breakingOpen ?? 0} breaking
                </Badge>
                <Badge tone={data.validation ? (data.validation.valid ? "green" : "red") : ""}>
                  docs {data.validation ? (data.validation.valid ? "valid" : "invalid") : "—"}
                </Badge>
              </div>
            </div>
          </div>

          {alert ? (
            <div className="sheet hero">
              <div className="kpi-label" style={{ color: "var(--red)" }}>Latest alert</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0", flexWrap: "wrap" }}>
                <MethodTag method={alert.method} />
                <span className="mono" style={{ fontSize: 15 }}>{alert.path}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                <SeverityBadge severity={alert.severity} />
                <BreakingBadge breaking={alert.breaking} />
              </div>
              <p className="muted" style={{ fontSize: 13 }}>{alert.detail.slice(0, 220)}</p>
              <div className="grid cols-2">
                <Link className="btn" href={`/mobile/changes?repo=${selectedId}`}>View change</Link>
                <Link className="btn primary" href={`/mobile/ask?repo=${selectedId}&q=${encodeURIComponent(`Why is ${alert.path} ${alert.breaking.replace(/-/g, " ")}?`)}`}>Ask Sentinel</Link>
              </div>
            </div>
          ) : (
            <div className="sheet good">
              <div className="kpi-label" style={{ color: "var(--accent)" }}>All clear</div>
              <p className="muted" style={{ fontSize: 13 }}>No API contract changes detected. Sentinel is watching.</p>
            </div>
          )}

          <div className="grid cols-2">
            <Link className="btn" href={`/mobile/changes?repo=${selectedId}`}>◈ Changes ({data.changes.length})</Link>
            <Link className="btn" href={`/mobile/ask?repo=${selectedId}`}>✦ Ask Sentinel</Link>
            <Link className="btn" href={`/mobile/docs?repo=${selectedId}`}>▤ Live docs</Link>
            <Link className="btn" href={`/mobile/scan?repo=${selectedId}`}>◉ Scan API</Link>
          </div>

          <div className="sheet" style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 13 }}>PHONE ALERTS {data.unread > 0 && <Badge tone="amber">{data.unread} unread</Badge>}</strong>
              {pushSupported ? (
                permission === "granted"
                  ? <Badge tone="green">browser alerts on</Badge>
                  : <button className="btn small" onClick={() => void enable()}>Enable alerts</button>
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>in-app only on this device</span>
              )}
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              AI: <span className="mono">{data.aiProvider ?? "—"}</span> · OpenAPI v{data.openapiVersion ?? "—"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default function MobileHome() {
  return <Suspense fallback={<div className="mobile-shell"><div className="sheet"><Spinner /> Loading…</div></div>}><MobileHomeInner /></Suspense>;
}

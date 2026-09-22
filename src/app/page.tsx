/** Landing: the 15-second judge experience, driven by live state. */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { get, post, shortSha, timeAgo } from "@/lib/client";
import { Badge, BreakingBadge, Empty, MethodTag, SeverityBadge, Spinner } from "@/components/ui";

interface Overview {
  repos: { id: string; name: string; status: string }[];
  repo: { id: string; name: string; status: string; lastSha: string | null } | null;
  health: { score: number; documented: number; totalEndpoints: number; outOfSync: number; breakingOpen: number; validation: string } | null;
  latestRun: { id: string; status: string; startedAt: string; aiSummary?: string } | null;
  changes: { id: string; type: string; severity: string; breaking: string; method: string; path: string; detail: string }[];
  validation: { valid: boolean; operations: number } | null;
}

export default function Home() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await get<Overview>("/api/overview"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }
  useEffect(() => { void load(); }, []);

  async function setupDemo() {
    setBusy(true);
    setError("");
    try {
      await post("/api/demo/ensure");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Demo setup failed.");
    } finally {
      setBusy(false);
    }
  }

  const top = data?.changes?.[0];
  return (
    <div className="shell">
      <div className="page-head" style={{ marginTop: 40 }}>
        <div>
          <Badge tone="cyan">API CHANGE INTELLIGENCE</Badge>
          <h1 style={{ fontSize: 34, marginTop: 12 }}>Your backend changed.</h1>
          <p style={{ fontSize: 15, maxWidth: 640 }}>
            Sentinel watches your source, detects contract drift, explains the blast radius,
            and keeps OpenAPI + live docs synchronized — from laptop to phone.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/dashboard" className="btn primary">Open dashboard</Link>
          <Link href="/demo" className="btn">3-minute demo</Link>
          <Link href="/mobile" className="btn">Phone experience</Link>
        </div>
      </div>

      {error && <div className="alert red">{error}</div>}
      {!data && !error && <div className="card"><Spinner /> Loading live state…</div>}

      {data && !data.repo && (
        <div className="card">
          <Empty icon="◌" title="No repository connected" hint="Connect GitHub or load the deterministic demo repository to see live change intelligence." />
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn primary" onClick={setupDemo} disabled={busy}>
              {busy ? <><Spinner /> Setting up…</> : "Load demo repositories"}
            </button>
            <Link href="/dashboard/repositories" className="btn">Connect GitHub</Link>
          </div>
        </div>
      )}

      {data?.repo && (
        <>
          <div className="grid cols-4">
            <div className="card">
              <div className="kpi-label">Repository</div>
              <div className="mono" style={{ fontSize: 15, marginTop: 6 }}>{data.repo.name}</div>
              <div className="muted mono" style={{ marginTop: 4 }}>@ {shortSha(data.repo.lastSha)}</div>
            </div>
            <div className="card">
              <div className="kpi-label">Doc health</div>
              <div className="kpi">{data.health?.score ?? 0}%</div>
              <div className="muted" style={{ fontSize: 12 }}>{data.health?.documented ?? 0}/{data.health?.totalEndpoints ?? 0} documented</div>
            </div>
            <div className="card">
              <div className="kpi-label">Open changes</div>
              <div className="kpi">{data.changes.length}</div>
              <div className="muted" style={{ fontSize: 12 }}>{data.health?.breakingOpen ?? 0} breaking-risk</div>
            </div>
            <div className="card">
              <div className="kpi-label">Spec validation</div>
              <div style={{ marginTop: 8 }}>
                {data.validation ? (
                  data.validation.valid ? <Badge tone="green">PASSED · {data.validation.operations} ops</Badge> : <Badge tone="red">FAILED</Badge>
                ) : <Badge>not run</Badge>}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {data.latestRun ? `last run ${data.latestRun.status} · ${timeAgo(data.latestRun.startedAt)}` : "no runs yet"}
              </div>
            </div>
          </div>

          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <div className="card">
              <h3>WHAT CHANGED <span className="sub">— deterministic diff</span></h3>
              {!top && <p className="muted">No contract changes detected. The API surface is stable.</p>}
              {top && (
                <>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                    <MethodTag method={top.method} /> <span className="mono">{top.path}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    <SeverityBadge severity={top.severity} />
                    <BreakingBadge breaking={top.breaking} />
                    <Badge tone="cyan">{top.type}</Badge>
                  </div>
                  <p className="muted" style={{ fontSize: 13 }}>{top.detail}</p>
                  <Link href="/dashboard/changes" className="btn small">Inspect change</Link>
                </>
              )}
            </div>
            <div className="card">
              <h3>WHAT SENTINEL RECOMMENDS <span className="sub">— grounded AI</span></h3>
              <p className="muted" style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                {data.latestRun?.aiSummary ?? "Run an analysis to get a grounded engineering summary."}
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <Link href="/dashboard/agent" className="btn small">Ask Sentinel</Link>
                <Link href="/dashboard/documentation" className="btn small">Review docs sync</Link>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h3>PIPELINE <span className="sub">code → contract → impact → AI → OpenAPI → validation → docs → phone</span></h3>
            <div className="mono muted" style={{ lineHeight: 2 }}>
              GitHub push / webhook → signature verify → compare → incremental parse → normalize → diff → risk → impact → AI explain → patch → validate → publish → Swagger/Redoc → phone alert
            </div>
          </div>
        </>
      )}
    </div>
  );
}

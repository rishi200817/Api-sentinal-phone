/** Repository management: connect GitHub, demo setup, webhook config. */
"use client";

import { Suspense, useEffect, useState } from "react";
import { get, patch, post, shortSha, timeAgo } from "@/lib/client";
import type { RepoRow } from "@/components/repo-context";
import { Badge, Empty, LiveDot, Spinner } from "@/components/ui";

interface WebhookRow {
  id: string; deliveryId: string; event: string; valid: boolean; rejectReason?: string;
  branch?: string; beforeSha?: string; afterSha?: string; receivedAt: string; analysisId?: string; duplicate: boolean;
}

function ReposInner() {
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);

  async function load() {
    try {
      const d = await get<{ repos: RepoRow[] }>("/api/repos");
      setRepos(d.repos);
      const w = await get<{ webhooks: WebhookRow[] }>("/api/webhooks/github");
      setWebhooks(w.webhooks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }
  useEffect(() => { void load(); }, []);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await post("/api/repos", { url, branch: branch || undefined });
      setUrl(""); setBranch("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }

  async function setupDemo() {
    setBusy(true); setError("");
    try {
      await post("/api/demo/ensure");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Demo setup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function updateRepo(id: string, body: Record<string, unknown>) {
    try {
      await patch(`/api/repos/${id}`, body);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    }
  }

  async function resetRepo(id: string) {
    if (!confirm("Reset this repository? All analyses, snapshots, and published specs for it will be cleared.")) return;
    try {
      await post(`/api/repos/${id}/reset`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed.");
    }
  }

  return (
    <div className="shell">
      <div className="page-head">
        <div>
          <h1>Repositories</h1>
          <p>Connect GitHub for live monitoring, or use the deterministic demo repositories.</p>
        </div>
        <button className="btn" onClick={setupDemo} disabled={busy}>
          {busy ? <Spinner /> : "Load demo repositories"}
        </button>
      </div>
      {error && <div className="alert red">{error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>CONNECT GITHUB REPOSITORY</h3>
        <form onSubmit={connect} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: "2 1 280px" }}>
            <label className="field" style={{ margin: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>Repository URL</span>
              <input className="input mono" placeholder="https://github.com/owner/repo" value={url} onChange={(e) => setUrl(e.target.value)} required />
            </label>
          </div>
          <div style={{ flex: "1 1 140px" }}>
            <label className="field" style={{ margin: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>Branch (optional)</span>
              <input className="input mono" placeholder="auto: default branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
            </label>
          </div>
          <button className="btn primary" type="submit" disabled={busy || !url.trim()}>
            {busy ? <Spinner /> : "Connect"}
          </button>
        </form>
        <p className="hint muted" style={{ fontSize: 12, marginTop: 8 }}>
          Sentinel verifies access and resolves the real default branch before saving. Private repos need a token in Settings.
        </p>
      </div>

      {!repos.length && <div className="card"><Empty icon="◌" title="No repositories" hint="Connect one above or load the demos." /></div>}

      <div className="grid cols-2">
        {repos.map((r) => (
          <div className="card" key={r.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <strong className="mono">{r.name}</strong>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {r.provider} · {r.defaultBranch} · HEAD {shortSha(r.lastSha)}
                </div>
              </div>
              <LiveDot status={r.status === "connected" ? "live" : r.status === "error" ? "warn" : "off"} label={r.status.toUpperCase()} />
            </div>
            {r.statusMessage && <div className="alert amber" style={{ margin: "10px 0 0", fontSize: 12 }}>{r.statusMessage}</div>}
            <div className="grid cols-2" style={{ marginTop: 12 }}>
              <label className="field" style={{ margin: 0 }}>
                <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>Auto-sync policy</span>
                <select className="select" value={r.autoSyncPolicy} onChange={(e) => updateRepo(r.id, { autoSyncPolicy: e.target.value })}>
                  <option value="manual">Manual (approval)</option>
                  <option value="auto-safe">Auto (safe only)</option>
                  <option value="auto-all">Auto (all valid)</option>
                </select>
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 6 }}>Webhook monitoring</span>
                <select
                  className="select"
                  value={r.webhookEnabled ? "on" : "off"}
                  onChange={(e) => updateRepo(r.id, { webhookEnabled: e.target.value === "on" })}
                  disabled={r.provider === "demo"}
                >
                  <option value="on">Enabled</option>
                  <option value="off">Disabled</option>
                </select>
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <a className="btn small" href={`/dashboard?repo=${r.id}`}>Open</a>
              <button className="btn small" onClick={() => post(`/api/repos/${r.id}/analyze`, {}).then(load).catch((e) => setError(e.message))}>
                Analyze now
              </button>
              <button className="btn small danger" onClick={() => resetRepo(r.id)}>Reset</button>
              {r.provider === "demo" && <Badge tone="cyan">demo</Badge>}
              {r.webhookSecretSet && <Badge tone="green">secret set</Badge>}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>WEBHOOK ENDPOINT</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Point a GitHub webhook (push events, JSON) at <code className="mono">POST /api/webhooks/github</code> with
          content-type <code className="mono">application/json</code> and the secret configured in Settings.
          Signatures are verified with HMAC-SHA256; invalid deliveries are rejected and logged below.
        </p>
        <div className="code-block">{`Payload URL:  <your-deploy-url>/api/webhooks/github\nContent type: application/json\nSecret:       <same as Settings → webhook secret>\nEvents:       Just the push event`}</div>
      </div>

      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table className="data">
          <thead>
            <tr><th>Received</th><th>Event</th><th>Branch</th><th>SHA</th><th>Result</th><th>Analysis</th></tr>
          </thead>
          <tbody>
            {webhooks.length === 0 && <tr><td colSpan={6} className="muted">No webhook deliveries recorded yet.</td></tr>}
            {webhooks.map((w) => (
              <tr key={w.id}>
                <td className="mono" style={{ whiteSpace: "nowrap" }}>{timeAgo(w.receivedAt)}</td>
                <td><Badge>{w.event}</Badge></td>
                <td className="mono">{w.branch ?? "—"}</td>
                <td className="mono">{shortSha(w.afterSha)}</td>
                <td>
                  {!w.valid && <Badge tone="red">rejected</Badge>}
                  {w.valid && w.duplicate && <Badge tone="violet">duplicate</Badge>}
                  {w.valid && !w.duplicate && !w.rejectReason && <Badge tone="green">accepted</Badge>}
                  {w.valid && w.rejectReason && <Badge tone="amber">ignored</Badge>}
                  {w.rejectReason && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{w.rejectReason}</div>}
                </td>
                <td className="mono" style={{ fontSize: 11 }}>{w.analysisId ? w.analysisId.slice(0, 18) + "…" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ReposPage() {
  return <Suspense fallback={<div className="shell"><div className="card"><Spinner /> Loading…</div></div>}><ReposInner /></Suspense>;
}

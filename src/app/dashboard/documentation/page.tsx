/** Documentation: validation, versions, selective sync, approvals. */
"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { get, post } from "@/lib/client";
import { RepoPicker, useRepos } from "@/components/repo-context";
import { Badge, Empty, MethodTag, Spinner } from "@/components/ui";

interface Change { id: string; type: string; severity: string; method: string; path: string; detail: string; synced: boolean }
interface Approval { id: string; changeIds: string[]; status: string; patchPreview?: string; createdAt: string }
interface Preview {
  changeIds: string[]; added: string[]; patched: string[]; removed: string[];
  skipped: { id: string; reason: string }[];
  validation: { valid: boolean; operations: number; errors: { path: string; message: string }[]; warnings: { path: string; message: string }[]; engine: string[] };
  preview: string; baseSource: string;
}
interface Spec { version: number; source: string; createdAt: string; validation: Preview["validation"] }

function DocsInner() {
  const { selectedId } = useRepos();
  const [changes, setChanges] = useState<Change[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [versions, setVersions] = useState<{ version: number; source: string; valid: boolean; operations: number; createdAt: string }[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [allowDelete, setAllowDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const load = useCallback(async () => {
    if (!selectedId) return;
    setError(""); setOkMsg("");
    try {
      const [c, a, s, v] = await Promise.all([
        get<{ changes: Change[] }>(`/api/changes?repoId=${selectedId}`),
        get<{ approvals: Approval[] }>(`/api/approvals?repoId=${selectedId}`),
        get<{ openapi: Spec }>(`/api/openapi?repoId=${selectedId}`).catch(() => ({ openapi: null as unknown as Spec })),
        get<{ versions: { version: number; source: string; valid: boolean; operations: number; createdAt: string }[] }>(`/api/openapi?repoId=${selectedId}&version=list`),
      ]);
      setChanges(c.changes);
      setApprovals(a.approvals);
      setSpec(s.openapi ?? null);
      setVersions(v.versions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }, [selectedId]);
  useEffect(() => { void load(); }, [load]);

  const unsynced = changes.filter((c) => !c.synced);
  const toggle = (id: string) => {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  async function runPreview(ids: string[]) {
    if (!ids.length) return;
    setBusy("preview"); setError(""); setOkMsg("");
    try {
      const d = await post<{ preview: Preview }>("/api/sync/preview", { repoId: selectedId, changeIds: ids, allowDelete });
      setPreview(d.preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runApply(ids: string[]) {
    if (!ids.length) return;
    if (!confirm(`Publish ${ids.length} change(s) to OpenAPI? The spec will be re-validated; invalid specs are never published.`)) return;
    setBusy("apply"); setError(""); setOkMsg("");
    try {
      const d = await post<{ version: number; validation: Preview["validation"] }>("/api/sync/apply", {
        repoId: selectedId, changeIds: ids, allowDelete, confirm: true,
      });
      setOkMsg(`Published OpenAPI v${d.version} — validation ${d.validation.valid ? "PASSED" : "FAILED"}.`);
      setPreview(null);
      setPicked(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setBusy(null);
    }
  }

  async function decideApproval(id: string, decision: "approve" | "reject") {
    if (decision === "approve" && !confirm("Approve and publish this sync? Invalid specs are rejected automatically.")) return;
    setBusy(id); setError(""); setOkMsg("");
    try {
      await post(`/api/approvals/${id}`, { decision, allowDelete });
      setOkMsg(decision === "approve" ? "Approved and published." : "Rejected — nothing published.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decision failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="shell">
      <div className="page-head">
        <div>
          <h1>Documentation</h1>
          <p>Generated OpenAPI, validation state, selective sync, and the approval workflow.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <RepoPicker />
          <Link className="btn small" href={`/docs/swagger?repo=${selectedId}`}>Swagger</Link>
          <Link className="btn small" href={`/docs/redoc?repo=${selectedId}`}>Redoc</Link>
        </div>
      </div>
      {error && <div className="alert red">{error}</div>}
      {okMsg && <div className="alert green">{okMsg}</div>}

      <div className="grid cols-3">
        <div className="card">
          <div className="kpi-label">Published spec</div>
          <div className="kpi">{spec ? `v${spec.version}` : "—"}</div>
          <div className="muted" style={{ fontSize: 12 }}>{spec ? `source: ${spec.source}` : "no spec published yet"}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Validation</div>
          <div style={{ marginTop: 8 }}>
            {spec?.validation
              ? spec.validation.valid
                ? <Badge tone="green">PASSED · {spec.validation.operations} ops</Badge>
                : <Badge tone="red">FAILED · {spec.validation.errors.length} errors</Badge>
              : <Badge>unknown</Badge>}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {spec?.validation ? spec.validation.engine.join(" + ") : "—"}
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Sync status</div>
          <div className="kpi">{changes.length - unsynced.length}<span className="muted" style={{ fontSize: 16 }}>/{changes.length}</span></div>
          <div className="muted" style={{ fontSize: 12 }}>changes synced</div>
        </div>
      </div>

      {spec?.validation && !spec.validation.valid && (
        <div className="card" style={{ marginTop: 14, borderColor: "rgba(248,113,113,0.4)" }}>
          <h3>VALIDATION ERRORS <span className="sub">publish is blocked until resolved</span></h3>
          {spec.validation.errors.map((e, i) => (
            <div key={i} className="mono" style={{ fontSize: 12, padding: "4px 0" }}>
              <span style={{ color: "var(--red)" }}>ERROR</span> {e.path}: {e.message}
            </div>
          ))}
        </div>
      )}

      {approvals.filter((a) => a.status === "pending").length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>PENDING APPROVALS</h3>
          {approvals.filter((a) => a.status === "pending").map((a) => (
            <div key={a.id} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong className="mono" style={{ fontSize: 12 }}>{a.id}</strong>
                <Badge tone="amber">{a.changeIds.length} changes</Badge>
                <span className="muted" style={{ fontSize: 12 }}>{new Date(a.createdAt).toLocaleString()}</span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button className="btn small primary" disabled={busy !== null} onClick={() => decideApproval(a.id, "approve")}>
                    {busy === a.id ? <Spinner /> : "Approve & publish"}
                  </button>
                  <button className="btn small danger" disabled={busy !== null} onClick={() => decideApproval(a.id, "reject")}>Reject</button>
                </span>
              </div>
              {a.patchPreview && <div className="code-block" style={{ maxHeight: 220 }}>{a.patchPreview.slice(0, 4000)}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <h3>SELECTIVE SYNC <span className="sub">{unsynced.length} unsynced</span></h3>
        {!unsynced.length && <Empty icon="✓" title="Everything is synced" hint="New analyses will list their changes here." />}
        {unsynced.map((c) => (
          <label key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} style={{ marginTop: 4 }} aria-label={`Select ${c.method} ${c.path}`} />
            <span>
              <MethodTag method={c.method} /> <span className="mono">{c.path}</span>{" "}
              <Badge tone={c.severity === "LOW" ? "green" : "red"}>{c.severity}</Badge> <Badge tone="cyan">{c.type}</Badge>
              <div className="muted">{c.detail.slice(0, 220)}</div>
            </span>
          </label>
        ))}
        {unsynced.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn small" onClick={() => setPicked(new Set(unsynced.map((c) => c.id)))}>Select all valid</button>
            <button className="btn small" onClick={() => setPicked(new Set())}>Clear</button>
            <label className="muted" style={{ fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={allowDelete} onChange={(e) => setAllowDelete(e.target.checked)} />
              allow endpoint deletions
            </label>
            <span style={{ flex: 1 }} />
            <button className="btn" disabled={busy !== null || !picked.size} onClick={() => runPreview([...picked])}>
              {busy === "preview" ? <Spinner /> : `Preview (${picked.size})`}
            </button>
            <button className="btn primary" disabled={busy !== null || !picked.size} onClick={() => runApply([...picked])}>
              {busy === "apply" ? <Spinner /> : `Sync selected (${picked.size})`}
            </button>
          </div>
        )}
      </div>

      {preview && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>PATCH PREVIEW <span className="sub">base: {preview.baseSource}</span></h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <Badge tone="green">+{preview.added.length} added</Badge>
            <Badge tone="cyan">~{preview.patched.length} patched</Badge>
            <Badge tone={preview.removed.length ? "red" : ""}>−{preview.removed.length} removed</Badge>
            {preview.validation.valid
              ? <Badge tone="green">VALID · {preview.validation.operations} ops</Badge>
              : <Badge tone="red">INVALID · {preview.validation.errors.length} errors</Badge>}
          </div>
          {!preview.validation.valid && preview.validation.errors.map((e, i) => (
            <div key={i} className="mono" style={{ fontSize: 12, color: "var(--red)" }}>ERROR {e.path}: {e.message}</div>
          ))}
          <div className="code-block" style={{ maxHeight: 320 }}>{preview.preview}</div>
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table className="data">
          <thead><tr><th>Version</th><th>Source</th><th>Operations</th><th>Validation</th><th>Published</th></tr></thead>
          <tbody>
            {!versions.length && <tr><td colSpan={5} className="muted">No versions yet.</td></tr>}
            {versions.map((v) => (
              <tr key={v.version}>
                <td className="mono">v{v.version}</td>
                <td><Badge>{v.source}</Badge></td>
                <td className="mono">{v.operations}</td>
                <td>{v.valid ? <Badge tone="green">passed</Badge> : <Badge tone="red">failed</Badge>}</td>
                <td className="muted">{new Date(v.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DocsPage() {
  return <Suspense fallback={<div className="shell"><div className="card"><Spinner /> Loading…</div></div>}><DocsInner /></Suspense>;
}

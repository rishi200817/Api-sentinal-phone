/** API changes: list + grounded detail with diff, impact, and actions. */
"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { get, post } from "@/lib/client";
import { RepoPicker, useRepos } from "@/components/repo-context";
import {
  Badge, BreakingBadge, Empty, MethodTag, RichText, SeverityBadge, Spinner,
} from "@/components/ui";

interface Change {
  id: string; type: string; severity: string; breaking: string;
  method: string; path: string; summary: string; detail: string;
  fieldChanges: { kind: string; location: string; field?: string; before?: string; after?: string; note: string }[];
  before?: { sourceFile: string; sourceLine: number } | null;
  after?: { sourceFile: string; sourceLine: number } | null;
  recommendation: string; evidence: string[]; synced: boolean; createdAt: string;
}

function ChangesInner() {
  const { selectedId } = useRepos();
  const search = useSearchParams();
  const focusId = search?.get("id") ?? null;
  const [changes, setChanges] = useState<Change[]>([]);
  const [open, setOpen] = useState<string | null>(focusId);
  const [explain, setExplain] = useState<Record<string, { text: string; provider: string }>>({});
  const [migration, setMigration] = useState<Record<string, string>>({});
  const [impact, setImpact] = useState<Record<string, { consumerFile: string; consumerLine?: number; matchKind: string; snippet: string; note: string }[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    if (!selectedId) return;
    try {
      const d = await get<{ changes: Change[] }>(`/api/changes?repoId=${selectedId}`);
      setChanges(d.changes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load changes.");
    }
  }, [selectedId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (focusId) setOpen(focusId); }, [focusId]);

  async function runExplain(c: Change) {
    setBusy(`ex-${c.id}`);
    try {
      const d = await post<{ text: string; provider: string; kind: string }>(`/api/changes/${c.id}/explain`, { repoId: selectedId });
      setExplain((s) => ({ ...s, [c.id]: { text: d.text, provider: `${d.kind}:${d.provider}` } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Explanation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runMigration(c: Change) {
    setBusy(`mi-${c.id}`);
    try {
      const d = await post<{ text: string }>(`/api/changes/${c.id}/migration`, { repoId: selectedId });
      setMigration((s) => ({ ...s, [c.id]: d.text }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Migration failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runImpact(c: Change) {
    setBusy(`im-${c.id}`);
    try {
      const d = await get<{ findings: { changeId: string; consumerFile: string; consumerLine?: number; matchKind: string; snippet: string; note: string }[] }>(`/api/impact?changeId=${c.id}`);
      setImpact((s) => ({ ...s, [c.id]: d.findings }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impact lookup failed.");
    } finally {
      setBusy(null);
    }
  }

  const list = changes.filter((c) => {
    if (filter === "breaking") return c.severity === "HIGH" || c.severity === "CRITICAL";
    if (filter === "unsynced") return !c.synced;
    if (filter === "synced") return c.synced;
    return true;
  });

  return (
    <div className="shell">
      <div className="page-head">
        <div>
          <h1>API Changes</h1>
          <p>Deterministic contract diffs with field-level evidence and grounded actions.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <RepoPicker />
          <select className="select" style={{ width: "auto" }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter changes">
            <option value="all">All ({changes.length})</option>
            <option value="breaking">Breaking-risk</option>
            <option value="unsynced">Unsynced</option>
            <option value="synced">Synced</option>
          </select>
        </div>
      </div>
      {error && <div className="alert red">{error}</div>}
      {!list.length && <div className="card"><Empty icon="✓" title="No changes" hint="Run an analysis — diffs will appear here with evidence." /></div>}

      {list.map((c) => (
        <div className="card" key={c.id} style={{ marginBottom: 12 }}>
          <div
            style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", cursor: "pointer" }}
            onClick={() => setOpen(open === c.id ? null : c.id)}
            role="button" tabIndex={0} aria-expanded={open === c.id}
            onKeyDown={(e) => { if (e.key === "Enter") setOpen(open === c.id ? null : c.id); }}
          >
            <MethodTag method={c.method} />
            <span className="mono" style={{ fontSize: 14 }}>{c.path}</span>
            <SeverityBadge severity={c.severity} />
            <BreakingBadge breaking={c.breaking} />
            <Badge tone="cyan">{c.type}</Badge>
            {c.synced ? <Badge tone="green">synced</Badge> : <Badge tone="amber">unsynced</Badge>}
            <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>{open === c.id ? "▾" : "▸"}</span>
          </div>

          {open === c.id && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13.5 }}>{c.detail}</p>
              <div className="mono muted" style={{ fontSize: 12 }}>
                Evidence: {c.evidence.join(" · ") || "—"}
              </div>

              {c.fieldChanges.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 10 }}>
                  <table className="data">
                    <thead><tr><th>Field diff</th><th>Location</th><th>Before</th><th>After</th></tr></thead>
                    <tbody>
                      {c.fieldChanges.map((f, i) => (
                        <tr key={i}>
                          <td><Badge>{f.kind}</Badge> {f.field && <code className="mono">{f.field}</code>}</td>
                          <td className="mono">{f.location}</td>
                          <td>{f.before ? <span className="diff-del mono">{f.before}</span> : <span className="muted">—</span>}</td>
                          <td>{f.after ? <span className="diff-add mono">{f.after}</span> : <span className="muted">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="alert cyan"><strong>Recommendation:</strong> {c.recommendation}</div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button className="btn small" disabled={busy !== null} onClick={() => runExplain(c)}>
                  {busy === `ex-${c.id}` ? <Spinner /> : "Explain"}
                </button>
                <button className="btn small" disabled={busy !== null} onClick={() => runImpact(c)}>
                  {busy === `im-${c.id}` ? <Spinner /> : "Show impact"}
                </button>
                <button className="btn small" disabled={busy !== null} onClick={() => runMigration(c)}>
                  {busy === `mi-${c.id}` ? <Spinner /> : "Generate migration"}
                </button>
                <Link className="btn small" href={`/dashboard/documentation?repo=${selectedId}`}>Review docs sync</Link>
              </div>

              {explain[c.id] && (
                <div className="card" style={{ marginTop: 10, background: "var(--panel-solid)" }}>
                  <h3>EXPLANATION <span className="sub">via {explain[c.id].provider}</span></h3>
                  <div style={{ fontSize: 13.5, lineHeight: 1.6 }}><RichText text={explain[c.id].text} /></div>
                </div>
              )}
              {impact[c.id] && (
                <div className="card" style={{ marginTop: 10, background: "var(--panel-solid)" }}>
                  <h3>IMPACT <span className="sub">{impact[c.id].length} references</span></h3>
                  {!impact[c.id].length && <p className="muted">No consumer references found in the scanned repository.</p>}
                  {impact[c.id].map((f, i) => (
                    <div key={i} style={{ padding: "7px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                      <Badge tone={f.matchKind === "verified-reference" ? "green" : f.matchKind === "likely-consumer" ? "amber" : "cyan"}>
                        {f.matchKind.replace(/-/g, " ")}
                      </Badge>{" "}
                      <code className="mono">{f.consumerFile}{f.consumerLine ? `:${f.consumerLine}` : ""}</code>
                      <div className="muted" style={{ fontSize: 12 }}>{f.note}</div>
                      <div className="code-block">{f.snippet}</div>
                    </div>
                  ))}
                </div>
              )}
              {migration[c.id] && (
                <div className="card" style={{ marginTop: 10, background: "var(--panel-solid)" }}>
                  <h3>MIGRATION GUIDE</h3>
                  <div style={{ fontSize: 13.5, lineHeight: 1.6 }}><RichText text={migration[c.id]} /></div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ChangesPage() {
  return <Suspense fallback={<div className="shell"><div className="card"><Spinner /> Loading…</div></div>}><ChangesInner /></Suspense>;
}

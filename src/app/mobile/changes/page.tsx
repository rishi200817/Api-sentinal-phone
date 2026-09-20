/** Mobile changes feed with review + approve. */
"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { get, post } from "@/lib/client";
import { useRepos } from "@/components/repo-context";
import { Badge, BreakingBadge, Empty, MethodTag, SeverityBadge, Spinner } from "@/components/ui";

interface Change {
  id: string; type: string; severity: string; breaking: string;
  method: string; path: string; detail: string;
  fieldChanges: { note: string }[];
  recommendation: string; synced: boolean;
}

function ChangesInner() {
  const { selectedId } = useRepos();
  const [changes, setChanges] = useState<Change[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const load = useCallback(async () => {
    if (!selectedId) return;
    const d = await get<{ changes: Change[] }>(`/api/changes?repoId=${selectedId}`);
    setChanges(d.changes);
  }, [selectedId]);
  useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);

  async function syncOne(id: string) {
    if (!confirm("Sync this change to OpenAPI? The spec is re-validated before publish.")) return;
    setBusy(true); setError(""); setOkMsg("");
    try {
      const d = await post<{ version: number }>(`/api/sync/apply`, { repoId: selectedId, changeIds: [id], allowDelete: false, confirm: true });
      setOkMsg(`Synced — published OpenAPI v${d.version}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mobile-shell">
      <div className="mobile-top">
        <strong style={{ fontSize: 18 }}>◈ Changes</strong>
        <Badge tone={changes.some((c) => c.severity === "HIGH" || c.severity === "CRITICAL") ? "red" : "green"}>
          {changes.length} open
        </Badge>
      </div>
      {error && <div className="alert red">{error}</div>}
      {okMsg && <div className="alert green">{okMsg}</div>}
      {!changes.length && <div className="sheet"><Empty icon="✓" title="No changes" hint="The API surface is stable." /></div>}
      {changes.map((c) => (
        <div className="sheet" key={c.id} style={c.severity === "HIGH" || c.severity === "CRITICAL" ? { borderColor: "rgba(248,113,113,0.45)" } : undefined}>
          <div onClick={() => setOpen(open === c.id ? null : c.id)} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter") setOpen(open === c.id ? null : c.id); }}
            style={{ cursor: "pointer" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <MethodTag method={c.method} />
              <span className="mono" style={{ fontSize: 14 }}>{c.path}</span>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <SeverityBadge severity={c.severity} />
              <BreakingBadge breaking={c.breaking} />
              {c.synced ? <Badge tone="green">synced</Badge> : <Badge tone="amber">unsynced</Badge>}
            </div>
          </div>
          {open === c.id && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              <p className="muted">{c.detail}</p>
              {c.fieldChanges.map((f, i) => <div key={i}>• {f.note}</div>)}
              <div className="alert cyan" style={{ marginTop: 8 }}>{c.recommendation}</div>
              <div className="grid cols-2" style={{ marginTop: 8 }}>
                <Link className="btn small" href={`/mobile/ask?repo=${selectedId}&q=${encodeURIComponent(`Explain ${c.method} ${c.path} (${c.type})`)}`}>
                  Explain
                </Link>
                {!c.synced ? (
                  <button className="btn small primary" disabled={busy} onClick={() => syncOne(c.id)}>
                    {busy ? <Spinner /> : "Sync this change"}
                  </button>
                ) : (
                  <Link className="btn small" href={`/mobile/docs?repo=${selectedId}`}>View docs</Link>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function MobileChanges() {
  return <Suspense fallback={<div className="mobile-shell"><div className="sheet"><Spinner /> Loading…</div></div>}><ChangesInner /></Suspense>;
}

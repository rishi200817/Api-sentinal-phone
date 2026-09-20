/** Mobile "more": endpoints, activity, approvals, links. */
"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { get, post } from "@/lib/client";
import { useRepos } from "@/components/repo-context";
import { Badge, Empty, MethodTag, Spinner } from "@/components/ui";

function MoreInner() {
  const { selectedId, selected } = useRepos();
  const [eps, setEps] = useState<{ id: string; method: string; path: string }[]>([]);
  const [approvals, setApprovals] = useState<{ id: string; changeIds: string[] }[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!selectedId) return;
    try {
      const [e, a] = await Promise.all([
        get<{ endpoints: { id: string; method: string; path: string }[] }>(`/api/endpoints?repoId=${selectedId}`),
        get<{ approvals: { id: string; changeIds: string[]; status: string }[] }>(`/api/approvals?repoId=${selectedId}&status=pending`),
      ]);
      setEps(e.endpoints);
      setApprovals(a.approvals);
    } catch { /* stay empty rather than fake */ }
  }, [selectedId]);
  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, decision: "approve" | "reject") {
    if (!confirm(decision === "approve" ? "Approve and publish this sync?" : "Reject this sync? Nothing will be published.")) return;
    try {
      await post(`/api/approvals/${id}`, { decision, allowDelete: false });
      setMsg(decision === "approve" ? "Approved and published." : "Rejected.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Decision failed.");
    }
  }

  return (
    <div className="mobile-shell">
      <div className="mobile-top">
        <strong style={{ fontSize: 18 }}>⋯ More</strong>
        {selected && <span className="muted mono" style={{ fontSize: 12 }}>{selected.name}</span>}
      </div>
      {msg && <div className="alert cyan">{msg}</div>}

      <div className="sheet">
        <strong style={{ fontSize: 13 }}>APPROVALS {approvals.length > 0 && <Badge tone="amber">{approvals.length} pending</Badge>}</strong>
        {!approvals.length && <p className="muted" style={{ fontSize: 13 }}>Nothing waiting for review.</p>}
        {approvals.map((a) => (
          <div key={a.id} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
            <div className="mono" style={{ fontSize: 12 }}>{a.changeIds.length} change(s) awaiting decision</div>
            <div className="grid cols-2" style={{ marginTop: 8 }}>
              <button className="btn small primary" onClick={() => decide(a.id, "approve")}>Approve</button>
              <button className="btn small danger" onClick={() => decide(a.id, "reject")}>Reject</button>
            </div>
          </div>
        ))}
      </div>

      <div className="sheet">
        <strong style={{ fontSize: 13 }}>ENDPOINTS ({eps.length})</strong>
        {!eps.length && <p className="muted" style={{ fontSize: 13 }}>Run an analysis to extract the API surface.</p>}
        {eps.slice(0, 30).map((e) => (
          <div key={e.id} style={{ padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: 13 }}>
            <MethodTag method={e.method} /> <span className="mono">{e.path}</span>
          </div>
        ))}
        {eps.length > 30 && <p className="muted" style={{ fontSize: 12 }}>…and {eps.length - 30} more (see desktop).</p>}
      </div>

      <div className="grid cols-2">
        <Link className="btn" href={`/mobile/scan?repo=${selectedId}`}>◉ Scan API</Link>
        <Link className="btn" href={`/dashboard/activity?repo=${selectedId}`}>Activity log</Link>
        <Link className="btn" href="/dashboard/phone">Phone ↔ Workspace</Link>
        <Link className="btn" href="/dashboard">Desktop dashboard</Link>
      </div>
    </div>
  );
}

export default function MobileMore() {
  return <Suspense fallback={<div className="mobile-shell"><div className="sheet"><Spinner /> Loading…</div></div>}><MoreInner /></Suspense>;
}

/** Impact analysis: likely consumers of changed endpoints. */
"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { get } from "@/lib/client";
import { RepoPicker, useRepos } from "@/components/repo-context";
import { Badge, Empty, Spinner } from "@/components/ui";

interface Finding {
  id: string; changeId: string; consumerFile: string; consumerLine?: number;
  matchKind: string; snippet: string; note: string;
}
interface Change { id: string; method: string; path: string; type: string; severity: string }

function ImpactInner() {
  const { selectedId } = useRepos();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);

  const load = useCallback(async () => {
    if (!selectedId) return;
    const [f, c] = await Promise.all([
      get<{ findings: Finding[] }>(`/api/impact?repoId=${selectedId}`),
      get<{ changes: Change[] }>(`/api/changes?repoId=${selectedId}`),
    ]);
    setFindings(f.findings);
    setChanges(c.changes);
  }, [selectedId]);
  useEffect(() => { void load(); }, [load]);

  const byChange = new Map<string, Finding[]>();
  for (const f of findings) {
    const l = byChange.get(f.changeId) ?? [];
    l.push(f);
    byChange.set(f.changeId, l);
  }
  const changeOf = (id: string) => changes.find((c) => c.id === id);

  return (
    <div className="shell">
      <div className="page-head">
        <div>
          <h1>Impact</h1>
          <p>{findings.length} consumer references across {byChange.size} changes. Findings are references, not proof of breakage.</p>
        </div>
        <RepoPicker />
      </div>
      {!findings.length && <div className="card"><Empty icon="◎" title="No impact findings" hint="Impact is computed automatically on every analysis with changes." /></div>}
      {[...byChange.entries()].map(([changeId, list]) => {
        const c = changeOf(changeId);
        return (
          <div className="card" key={changeId} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              {c && <><strong className={`mono m-${c.method}`}>{c.method}</strong><span className="mono">{c.path}</span><Badge tone="cyan">{c.type}</Badge><Badge tone={c.severity === "LOW" ? "green" : "red"}>{c.severity}</Badge></>}
              <Link href={`/dashboard/changes?repo=${selectedId}&id=${changeId}`} className="btn small" style={{ marginLeft: "auto" }}>Open change</Link>
            </div>
            {list.map((f) => (
              <div key={f.id} style={{ padding: "8px 0", borderTop: "1px solid var(--border)", fontSize: 13 }}>
                <Badge tone={f.matchKind === "verified-reference" ? "green" : f.matchKind === "likely-consumer" ? "amber" : "cyan"}>
                  {f.matchKind.replace(/-/g, " ")}
                </Badge>{" "}
                <code className="mono">{f.consumerFile}{f.consumerLine ? `:${f.consumerLine}` : ""}</code>
                <div className="muted" style={{ fontSize: 12 }}>{f.note}</div>
                <div className="code-block">{f.snippet}</div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function ImpactPage() {
  return <Suspense fallback={<div className="shell"><div className="card"><Spinner /> Loading…</div></div>}><ImpactInner /></Suspense>;
}

/** Endpoint inventory from normalized contracts. */
"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { get } from "@/lib/client";
import { RepoPicker, useRepos } from "@/components/repo-context";
import { Badge, Empty, MethodTag, Spinner } from "@/components/ui";

interface EP {
  id: string; method: string; path: string; sourceFile: string; sourceLine: number;
  framework: string; summary?: string;
  pathParams: { name: string }[]; queryParams: { name: string }[];
  requestBody?: { fields: { name: string; required: boolean; type: string }[] };
  responses: { status: string }[];
  auth: { required: boolean }; confidence: string;
}

function EndpointsInner() {
  const { selectedId } = useRepos();
  const [eps, setEps] = useState<EP[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedId) return;
    const d = await get<{ endpoints: EP[] }>(`/api/endpoints?repoId=${selectedId}`);
    setEps(d.endpoints);
  }, [selectedId]);
  useEffect(() => { void load(); }, [load]);

  const list = eps.filter((e) =>
    !q || `${e.method} ${e.path} ${e.sourceFile}`.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="shell">
      <div className="page-head">
        <div>
          <h1>Endpoints</h1>
          <p>{eps.length} normalized contracts extracted from source. Click a row for schema detail.</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <RepoPicker />
        </div>
      </div>
      <div className="field" style={{ maxWidth: 420 }}>
        <input className="input mono" placeholder="Filter: method, path, file…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter endpoints" />
      </div>
      {!list.length && <div className="card"><Empty icon="◇" title="No endpoints" hint="Run an analysis to extract the API surface." /></div>}
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Method</th><th>Path</th><th>Source</th><th>Auth</th><th>Body</th><th>Confidence</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <>
                <tr key={e.id} className="clickable" onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <td><MethodTag method={e.method} /></td>
                  <td className="mono">{e.path}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{e.sourceFile}:{e.sourceLine}</td>
                  <td>{e.auth.required ? <Badge tone="amber">required</Badge> : <Badge>none</Badge>}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {e.requestBody?.fields.length ? e.requestBody.fields.map((f) => f.name).join(", ") : <span className="muted">—</span>}
                  </td>
                  <td><Badge tone={e.confidence === "detected" ? "green" : "violet"}>{e.confidence}</Badge></td>
                </tr>
                {open === e.id && (
                  <tr key={`${e.id}-d`}>
                    <td colSpan={6} style={{ background: "rgba(148,163,184,0.03)" }}>
                      <div className="grid cols-3">
                        <div>
                          <div className="kpi-label">Request body</div>
                          {!e.requestBody?.fields.length && <div className="muted">none observed</div>}
                          {e.requestBody?.fields.map((f) => (
                            <div key={f.name} className="mono" style={{ fontSize: 12 }}>
                              {f.name}: {f.type} {f.required ? "(required)" : "(optional)"}
                            </div>
                          ))}
                        </div>
                        <div>
                          <div className="kpi-label">Parameters</div>
                          {!e.pathParams.length && !e.queryParams.length && <div className="muted">none</div>}
                          {e.pathParams.map((p) => <div key={`p${p.name}`} className="mono" style={{ fontSize: 12 }}>{"{path}"} {p.name}</div>)}
                          {e.queryParams.map((p) => <div key={`q${p.name}`} className="mono" style={{ fontSize: 12 }}>{"{query}"} {p.name}</div>)}
                        </div>
                        <div>
                          <div className="kpi-label">Responses</div>
                          {e.responses.map((r) => <div key={r.status} className="mono" style={{ fontSize: 12 }}>{r.status}</div>)}
                          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{e.summary ?? ""}</div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EndpointsPage() {
  return <Suspense fallback={<div className="shell"><div className="card"><Spinner /> Loading…</div></div>}><EndpointsInner /></Suspense>;
}

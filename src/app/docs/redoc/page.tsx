/** Redoc view of the ACTUAL published spec (CDN with honest offline fallback). */
"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui";

declare global {
  interface Window { Redoc?: { init: (spec: unknown, opts: unknown, el: HTMLElement) => void } }
}

function RedocInner() {
  const search = useSearchParams();
  const repoId = search?.get("repo") ?? "";
  const [spec, setSpec] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [cdnFailed, setCdnFailed] = useState(false);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!repoId) { setError("Pick a repository first — Redoc renders its live published spec."); return; }
    (async () => {
      try {
        const res = await fetch(`/api/openapi/spec?repoId=${encodeURIComponent(repoId)}`, { cache: "no-store" });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || "No published spec yet.");
        }
        setSpec((await res.json()) as Record<string, unknown>);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load spec.");
      }
    })();
  }, [repoId]);

  useEffect(() => {
    if (!spec || !el.current) return;
    if (window.Redoc) {
      window.Redoc.init(spec, {}, el.current);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js";
    script.async = true;
    script.onload = () => {
      if (window.Redoc && el.current) window.Redoc.init(spec, {}, el.current);
      else setCdnFailed(true);
    };
    script.onerror = () => setCdnFailed(true);
    document.body.appendChild(script);
    const timer = setTimeout(() => {
      if (!window.Redoc) setCdnFailed(true);
    }, 12000);
    return () => { clearTimeout(timer); };
  }, [spec]);

  const paths = spec ? Object.entries((spec.paths ?? {}) as Record<string, Record<string, { summary?: string }>>) : [];

  return (
    <div className="shell">
      <div className="page-head">
        <div>
          <h1>Redoc</h1>
          <p>Live generated specification — three-panel reference docs.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn small" href={`/docs/swagger?repo=${repoId}`}>Swagger view</Link>
          <a className="btn small" href={`/api/openapi/spec?repoId=${encodeURIComponent(repoId)}`} download={`openapi-${repoId}.json`}>Download JSON</a>
        </div>
      </div>
      {error && <div className="alert red">{error}</div>}
      {!spec && !error && <div className="card"><Spinner /> Loading live spec…</div>}
      {spec && !cdnFailed && <div ref={el} className="card" style={{ padding: 0, overflow: "hidden", background: "#fff" }} />}
      {spec && cdnFailed && (
        <div className="card">
          <div className="alert amber">
            Redoc CDN unreachable in this environment — showing the built-in spec explorer instead (same live data, no CDN dependency).
          </div>
          {paths.map(([path, item]) => (
            <div key={path} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <div className="mono" style={{ fontWeight: 700 }}>{path}</div>
              {Object.entries(item).filter(([k]) => k !== "parameters").map(([verb, op]) => (
                <div key={verb} style={{ fontSize: 13, marginTop: 4 }}>
                  <strong className={`m-${verb.toUpperCase()}`}>{verb.toUpperCase()}</strong>
                  <span className="muted"> — {op.summary ?? "no summary"}</span>
                </div>
              ))}
            </div>
          ))}
          <div className="code-block" style={{ maxHeight: 400 }}>{JSON.stringify(spec, null, 2)}</div>
        </div>
      )}
    </div>
  );
}

export default function RedocPage() {
  return <Suspense fallback={<div className="shell"><div className="card"><Spinner /> Loading…</div></div>}><RedocInner /></Suspense>;
}

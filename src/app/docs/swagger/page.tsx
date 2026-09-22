/** Live Swagger UI rendering the ACTUAL published spec (bundled locally). */
"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import { get } from "@/lib/client";
import { Spinner } from "@/components/ui";

function SwaggerInner() {
  const search = useSearchParams();
  const repoId = search?.get("repo") ?? "";
  const [spec, setSpec] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<{ version: number; valid: boolean } | null>(null);

  useEffect(() => {
    if (!repoId) { setError("Pick a repository first — Swagger renders its live published spec."); return; }
    (async () => {
      try {
        const res = await fetch(`/api/openapi/spec?repoId=${encodeURIComponent(repoId)}`, { cache: "no-store" });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || "No published spec yet. Run an analysis and sync changes first.");
        }
        setSpec((await res.json()) as Record<string, unknown>);
        const m = await get<{ openapi: { version: number; validation: { valid: boolean } } }>(`/api/openapi?repoId=${encodeURIComponent(repoId)}`);
        setMeta({ version: m.openapi.version, valid: m.openapi.validation.valid });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load spec.");
      }
    })();
  }, [repoId]);

  return (
    <div className="shell">
      <div className="page-head">
        <div>
          <h1>Swagger</h1>
          <p>
            {meta ? <>Live spec v{meta.version} · validation {meta.valid ? "PASSED" : "FAILED"}</> : "Live generated specification"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn small" href={`/docs/redoc?repo=${repoId}`}>Redoc view</Link>
          <Link className="btn small" href={`/dashboard/documentation?repo=${repoId}`}>Sync controls</Link>
        </div>
      </div>
      {error && <div className="alert red">{error}</div>}
      {!spec && !error && <div className="card"><Spinner /> Loading live spec…</div>}
      {spec && (
        <div className="card" style={{ padding: 8, background: "#fff" }}>
          <SwaggerUI spec={spec} docExpansion="list" defaultModelsExpandDepth={1} />
        </div>
      )}
      <style>{`.swagger-ui .info { margin: 12px 0; }`}</style>
    </div>
  );
}

export default function SwaggerPage() {
  return <Suspense fallback={<div className="shell"><div className="card"><Spinner /> Loading…</div></div>}><SwaggerInner /></Suspense>;
}

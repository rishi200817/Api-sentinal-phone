/** Mobile docs: validation state + operation list from the live spec. */
"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { get } from "@/lib/client";
import { useRepos } from "@/components/repo-context";
import { Badge, Empty, MethodTag, Spinner } from "@/components/ui";

interface Spec {
  version: number; source: string;
  spec: { openapi: string; info: { title: string; version: string }; paths: Record<string, Record<string, { summary?: string }>> };
  validation: { valid: boolean; operations: number; errors: { path: string; message: string }[]; warnings: { path: string; message: string }[] };
}

function DocsInner() {
  const { selectedId } = useRepos();
  const [spec, setSpec] = useState<Spec | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!selectedId) return;
    try {
      const d = await get<{ openapi: Spec }>(`/api/openapi?repoId=${selectedId}`);
      setSpec(d.openapi);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No published docs yet.");
    }
  }, [selectedId]);
  useEffect(() => { void load(); }, [load]);

  const paths = spec ? Object.entries(spec.spec.paths ?? {}) : [];

  return (
    <div className="mobile-shell">
      <div className="mobile-top">
        <strong style={{ fontSize: 18 }}>▤ Live docs</strong>
        {spec?.validation.valid ? <Badge tone="green">VALID</Badge> : spec ? <Badge tone="red">INVALID</Badge> : null}
      </div>
      {error && <div className="alert amber">{error}</div>}
      {spec && (
        <>
          <div className="sheet good">
            <div className="mono" style={{ fontSize: 13 }}>{spec.spec.info.title} · v{spec.spec.info.version}</div>
            <div className="muted" style={{ fontSize: 12 }}>OpenAPI {spec.spec.openapi} · Sentinel v{spec.version} ({spec.source})</div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <Badge tone="cyan">{spec.validation.operations} ops</Badge>
              <Badge tone={spec.validation.warnings.length ? "amber" : "green"}>{spec.validation.warnings.length} warnings</Badge>
            </div>
            <div className="grid cols-2" style={{ marginTop: 10 }}>
              <Link className="btn small" href={`/docs/swagger?repo=${selectedId}`}>Swagger UI</Link>
              <Link className="btn small" href={`/docs/redoc?repo=${selectedId}`}>Redoc</Link>
            </div>
          </div>
          {!paths.length && <div className="sheet"><Empty icon="▤" title="No operations" hint="The published spec has no paths." /></div>}
          {paths.map(([path, item]) => (
            <div className="sheet" key={path}>
              <div className="mono" style={{ fontWeight: 700, fontSize: 13 }}>{path}</div>
              {Object.entries(item).filter(([k]) => k !== "parameters").map(([verb, op]) => (
                <div key={verb} style={{ fontSize: 13, marginTop: 6 }}>
                  <MethodTag method={verb.toUpperCase()} />
                  <span className="muted"> — {op.summary ?? "no summary"}</span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function MobileDocs() {
  return <Suspense fallback={<div className="mobile-shell"><div className="sheet"><Spinner /> Loading…</div></div>}><DocsInner /></Suspense>;
}

/** Scan API: real camera capture → vision-capable provider analysis. */
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { get, post } from "@/lib/client";
import { useRepos } from "@/components/repo-context";
import { Badge, RichText, Spinner } from "@/components/ui";

function ScanInner() {
  const { selectedId } = useRepos();
  const [photo, setPhoto] = useState<string | null>(null);
  const [question, setQuestion] = useState("What API details are visible here, and do they match our live spec?");
  const [answer, setAnswer] = useState<{ text: string; provider: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visionReady, setVisionReady] = useState<boolean | null>(null);
  const [providerLabel, setProviderLabel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Vision is real only when a model provider is connected.
    get<{ providers: { id: string; kind: string; connected: boolean; label: string }[]; active: string }>("/api/agent/status")
      .then((d) => {
        const active = d.providers.find((p) => p.id === d.active);
        setVisionReady(!!active && active.id !== "deterministic");
        setProviderLabel(active ? active.label : "none");
      })
      .catch(() => setVisionReady(false));
  }, []);

  function onFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Please capture or choose an image file.");
      return;
    }
    setError("");
    setAnswer(null);
    const reader = new FileReader();
    reader.onload = () => {
      // Downscale client-side so uploads stay small and fast (real processing).
      const img = new Image();
      img.onload = () => {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        setPhoto(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => setError("Could not read that image.");
      img.src = reader.result as string;
    };
    reader.readAsDataURL(f);
  }

  async function analyze() {
    if (!photo) return;
    setBusy(true); setError(""); setAnswer(null);
    try {
      const d = await post<{ answer: { answer: string; provider: string; providerKind: string } }>(
        "/api/agent/ask", { question, repoId: selectedId, imageDataUrl: photo }
      );
      setAnswer({ text: d.answer.answer, provider: `${d.answer.providerKind}:${d.answer.provider}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mobile-shell">
      <div className="mobile-top">
        <strong style={{ fontSize: 18 }}>◉ Scan API</strong>
        {visionReady === null
          ? <span className="muted">checking…</span>
          : visionReady
            ? <Badge tone="green">vision: {providerLabel}</Badge>
            : <Badge tone="amber">vision unavailable</Badge>}
      </div>

      {!visionReady && visionReady !== null && (
        <div className="alert amber">
          No vision-capable model is connected (active: {providerLabel || "deterministic fallback"}).
          Photos are captured for real, but automated visual analysis needs a local vision model
          (e.g. llava via the local runtime) or a configured remote vision provider.
        </div>
      )}

      {error && <div className="alert red">{error}</div>}

      <input
        ref={fileRef} type="file" accept="image/*" capture="environment"
        className="sr-only" aria-label="Capture photo"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {!photo && (
        <button className="btn primary block" style={{ minHeight: 64, fontSize: 16 }} onClick={() => fileRef.current?.click()}>
          📷 Capture code / docs / output
        </button>
      )}
      {photo && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="Captured API content" style={{ width: "100%", borderRadius: 14, border: "1px solid var(--border)", marginTop: 4 }} />
          <div className="grid cols-2" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => fileRef.current?.click()}>Retake</button>
            <button className="btn danger" onClick={() => { setPhoto(null); setAnswer(null); }}>Discard</button>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>What should Sentinel look for?</label>
            <textarea className="textarea" value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} />
          </div>
          <button className="btn primary block" disabled={busy} onClick={analyze} style={{ minHeight: 52 }}>
            {busy ? <><Spinner /> Analyzing…</> : "Analyze with Sentinel"}
          </button>
        </>
      )}

      {answer && (
        <div className="sheet" style={{ marginTop: 14 }}>
          <strong style={{ fontSize: 13 }}>SENTINEL <span className="muted">via {answer.provider}</span></strong>
          <div style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 8 }}>
            <RichText text={answer.text} />
          </div>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        Photos never leave your device except to your configured AI provider when you tap Analyze —
        and only then. Results are always cross-checked against the live analyzed API.
      </p>
    </div>
  );
}

export default function MobileScan() {
  return <Suspense fallback={<div className="mobile-shell"><div className="sheet"><Spinner /> Loading…</div></div>}><ScanInner /></Suspense>;
}

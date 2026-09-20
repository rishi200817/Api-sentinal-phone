/** AI agent: grounded chat + truthful provider status. */
"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { get, post } from "@/lib/client";
import { RepoPicker, useRepos } from "@/components/repo-context";
import { Badge, RichText, Spinner } from "@/components/ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
  provider?: string;
  evidence?: { label: string; ref: string }[];
}

const SUGGESTIONS = [
  "What changed in my API?",
  "Show breaking changes.",
  "Which files are affected?",
  "Is the OpenAPI specification valid?",
  "Show me the new endpoints.",
];

function AgentInner() {
  const { selectedId } = useRepos();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<{ id: string; kind: string; connected: boolean; label: string; detail: string }[]>([]);
  const [active, setActive] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const loadProviders = useCallback(async () => {
    try {
      const d = await get<{ providers: { id: string; kind: string; connected: boolean; label: string; detail: string }[]; active: string }>("/api/agent/status");
      setProviders(d.providers);
      setActive(d.active);
    } catch { /* show nothing rather than fake */ }
  }, []);
  useEffect(() => { void loadProviders(); }, [loadProviders]);
  useEffect(() => {
    setVoiceSupported(typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window));
    setSpeechSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setQ("");
    try {
      const d = await post<{ answer: { answer: string; provider: string; providerKind: string; evidence: { label: string; ref: string }[]; latencyMs: number } }>(
        "/api/agent/ask", { question: text, repoId: selectedId }
      );
      setMsgs((m) => [...m, {
        role: "assistant",
        content: d.answer.answer,
        provider: `${d.answer.providerKind}:${d.answer.provider} · ${d.answer.latencyMs}ms`,
        evidence: d.answer.evidence,
      }]);
      void loadProviders();
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `I couldn't answer that: ${e instanceof Error ? e.message : "unknown error"}` }]);
    } finally {
      setBusy(false);
    }
  }

  function toggleListen() {
    const SR = (window as unknown as { SpeechRecognition?: new () => WebRecognizer; webkitSpeechRecognition?: new () => WebRecognizer }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => WebRecognizer }).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    setListening(true);
    rec.onresult = (ev: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => {
      const text = ev.results[0][0].transcript;
      setQ(text);
      setListening(false);
      void ask(text);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  }

  interface WebRecognizer { lang: string; interimResults: boolean; onresult: unknown; onerror: unknown; onend: unknown; start(): void }

  function speak(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    if (speaking) { setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>]/g, "").slice(0, 1200));
    u.onend = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }

  return (
    <div className="shell" style={{ maxWidth: 920 }}>
      <div className="page-head">
        <div>
          <h1>Ask Sentinel</h1>
          <p>Grounded in the live analysis — endpoints, diffs, validation, and impact. Never generic.</p>
        </div>
        <RepoPicker compact />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>AI PROVIDERS <span className="sub">truthful status · priority local → remote → deterministic</span></h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {providers.map((p) => (
            <span key={p.id} title={p.detail}>
              <Badge tone={p.connected ? (p.id === active ? "green" : "cyan") : ""}>
                {p.id === active ? "● " : ""}{p.label}
              </Badge>
            </span>
          ))}
          {!providers.length && <span className="muted">Probing providers…</span>}
        </div>
        {providers.map((p) => (
          !p.connected && p.kind === "local" ? (
            <p key={p.id} className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              Local model: NOT CONNECTED — {p.detail} Using the deterministic grounded fallback.
            </p>
          ) : null
        ))}
      </div>

      <div className="card">
        <div className="chat-log" aria-live="polite">
          {!msgs.length && (
            <div className="msg assistant">
              Ask me about this repository&apos;s API — what changed, what might break, who is affected, or whether docs are in sync.
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="btn small" onClick={() => ask(s)} disabled={busy}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
              {m.evidence && m.evidence.length > 0 && (
                <div className="evidence">
                  {m.evidence.map((e, j) => <span key={j}>{e.label}: {e.ref}</span>)}
                </div>
              )}
              {m.provider && (
                <div className="provider-tag">
                  grounded · via {m.provider}
                  {speechSupported && (
                    <button className="btn small" style={{ marginLeft: 8 }} onClick={() => speak(m.content)}>
                      {speaking ? "Stop" : "Read aloud"}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="msg assistant"><Spinner /> Consulting the analysis…</div>}
          <div ref={bottom} />
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); void ask(q); }}
          style={{ display: "flex", gap: 8, marginTop: 8 }}
        >
          <input
            className="input" style={{ borderRadius: 24, padding: "13px 18px" }}
            placeholder={voiceSupported ? "Ask or tap the mic…" : "Ask about your API…"}
            value={q} onChange={(e) => setQ(e.target.value)} disabled={busy}
            aria-label="Ask Sentinel"
          />
          {voiceSupported && (
            <button type="button" className="btn" onClick={toggleListen} disabled={busy} aria-label="Voice input" style={{ borderRadius: "50%", width: 50, height: 50, padding: 0, fontSize: 20 }}>
              {listening ? "⏺" : "🎙"}
            </button>
          )}
          <button className="btn primary" type="submit" disabled={busy || !q.trim()}>Ask</button>
        </form>
        {!voiceSupported && <p className="muted" style={{ fontSize: 12 }}>Voice input is not supported in this browser — text works everywhere.</p>}
      </div>
    </div>
  );
}

export default function AgentPage() {
  return <Suspense fallback={<div className="shell"><div className="card"><Spinner /> Loading…</div></div>}><AgentInner /></Suspense>;
}

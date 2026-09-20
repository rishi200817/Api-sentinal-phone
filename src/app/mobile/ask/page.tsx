/** Mobile Ask Sentinel: voice + text, grounded answers. */
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { post } from "@/lib/client";
import { useRepos } from "@/components/repo-context";
import { RichText, Spinner } from "@/components/ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
  provider?: string;
  evidence?: { label: string; ref: string }[];
}

const SUGGESTIONS = [
  "What changed in my API?",
  "Show breaking changes.",
  "Why is login breaking?",
  "Which files are affected?",
  "Is the API synchronized?",
  "Show me the new endpoints.",
];

function AskInner() {
  const { selectedId } = useRepos();
  const search = useSearchParams();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [speechOn, setSpeechOn] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    setVoiceSupported(typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window));
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setQ("");
    try {
      const d = await post<{ answer: { answer: string; provider: string; providerKind: string; evidence: { label: string; ref: string }[] } }>(
        "/api/agent/ask", { question: text, repoId: selectedId }
      );
      setMsgs((m) => [...m, {
        role: "assistant",
        content: d.answer.answer,
        provider: `${d.answer.providerKind}:${d.answer.provider}`,
        evidence: d.answer.evidence,
      }]);
      if (speechOn && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(d.answer.answer.replace(/[*_`#>]/g, "").slice(0, 900)));
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: `Couldn't answer: ${e instanceof Error ? e.message : "unknown error"}` }]);
    } finally {
      setBusy(false);
    }
  }

  // Deep link: /mobile/ask?q=... asks immediately (used by alert hero).
  useEffect(() => {
    const preset = search?.get("q");
    if (preset && asked.current !== preset) {
      asked.current = preset;
      void ask(preset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, selectedId]);

  function listen() {
    const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) return;
    interface Rec { lang: string; interimResults: boolean; onresult: ((ev: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start(): void }
    const rec: Rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    setListening(true);
    rec.onresult = (ev) => {
      const text = ev.results[0][0].transcript;
      setListening(false);
      void ask(text);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  }

  return (
    <div className="mobile-shell">
      <div className="mobile-top">
        <strong style={{ fontSize: 18 }}>✦ Ask Sentinel</strong>
        <button
          className="btn small"
          onClick={() => {
            const next = !speechOn;
            setSpeechOn(next);
            if (!next && "speechSynthesis" in window) window.speechSynthesis.cancel();
          }}
          aria-pressed={speechOn}
        >
          {speechOn ? "🔊 speaking" : "🔈 silent"}
        </button>
      </div>

      <div className="chat-log" aria-live="polite">
        {!msgs.length && (
          <div className="msg assistant">
            Ask about your live API — changes, risks, impact, docs.
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn small" disabled={busy} onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`} style={{ maxWidth: "92%" }}>
            {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
            {m.evidence && m.evidence.length > 0 && (
              <div className="evidence">
                {m.evidence.map((e, j) => <span key={j}>{e.label}: {e.ref}</span>)}
              </div>
            )}
            {m.provider && <div className="provider-tag">grounded · via {m.provider}</div>}
          </div>
        ))}
        {busy && <div className="msg assistant"><Spinner /> Thinking…</div>}
        <div ref={bottom} />
      </div>

      <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 4px" }}>
        {voiceSupported ? (
          <button
            className={`mic-btn ${listening ? "listening" : ""}`}
            onClick={listen}
            disabled={busy}
            aria-label={listening ? "Listening… tap to stop" : "Tap to speak"}
          >
            {listening ? "⏺" : "🎙"}
          </button>
        ) : (
          <p className="muted" style={{ fontSize: 12 }}>Voice input unsupported in this browser — type below.</p>
        )}
      </div>
      {listening && <p style={{ textAlign: "center", color: "var(--cyan)", fontSize: 13 }}>Listening… speak now</p>}

      <form className="ask-bar" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input
          className="input" placeholder="Ask about your API…" value={q}
          onChange={(e) => setQ(e.target.value)} disabled={busy} aria-label="Ask Sentinel"
        />
        <button className="btn primary" type="submit" disabled={busy || !q.trim()} style={{ borderRadius: 24 }}>➤</button>
      </form>
    </div>
  );
}

export default function MobileAsk() {
  return <Suspense fallback={<div className="mobile-shell"><div className="sheet"><Spinner /> Loading…</div></div>}><AskInner /></Suspense>;
}

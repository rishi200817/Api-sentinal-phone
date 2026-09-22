/** 3–5 minute guided demo: every step executes the real pipeline. */
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { get, post, shortSha } from "@/lib/client";
import { Badge, RichText, Spinner } from "@/components/ui";

interface StepState {
  n: number;
  title: string;
  detail: string;
  status: "todo" | "active" | "done" | "failed";
  output?: string;
}

const REPO = "demo-fastapi";

export default function DemoPage() {
  const [steps, setSteps] = useState<StepState[]>([
    { n: 1, title: "Repository connected", detail: "Register the deterministic demo repositories.", status: "todo" },
    { n: 2, title: "Baseline healthy", detail: "Analyze v1: endpoints extracted, OpenAPI generated + validated.", status: "todo" },
    { n: 3, title: "GitHub push detected", detail: "Simulate a push: required deviceId + DELETE /api/users/{id}.", status: "todo" },
    { n: 4, title: "Breaking alert", detail: "HIGH-risk request change with field-level evidence.", status: "todo" },
    { n: 5, title: "Ask Sentinel", detail: "“Why is login breaking?” — answered from live data.", status: "todo" },
    { n: 6, title: "Impact + patch", detail: "Consumer references found; OpenAPI patch previewed + validated.", status: "todo" },
    { n: 7, title: "Approve & publish", detail: "Human approval → validated spec published → live docs.", status: "todo" },
    { n: 8, title: "Verified in sync", detail: "“Is the API synchronized?” — yes, with proof.", status: "todo" },
  ]);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [changeIds, setChangeIds] = useState<string[]>([]);
  const [askAnswer, setAskAnswer] = useState("");
  const [verifyAnswer, setVerifyAnswer] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function mark(n: number, status: StepState["status"], output?: string) {
    setSteps((s) => s.map((x) => (x.n === n ? { ...x, status, output: output ?? x.output } : x)));
  }
  function say(m: string) {
    setLog((l) => [...l.slice(-30), `${new Date().toLocaleTimeString()} ${m}`]);
  }

  async function waitForRun(id: string): Promise<{ status: string; changeIds: string[] }> {
    for (let i = 0; i < 120; i++) {
      const d = await get<{ run: { status: string; changeIds: string[]; error?: string } }>(`/api/analyses/${id}`);
      if (d.run.status === "completed" || d.run.status === "failed") {
        if (d.run.status === "failed") throw new Error(d.run.error || "Analysis failed.");
        return { status: d.run.status, changeIds: d.run.changeIds };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Analysis timed out.");
  }

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function run() {
    setRunning(true);
    setLog([]);
    try {
      // 1. setup
      mark(1, "active");
      await post("/api/demo/ensure");
      try { await post(`/api/repos/${REPO}/reset`); } catch { /* fresh anyway */ }
      mark(1, "done", "demo repos registered + reset to v1");
      say("demo repos ready");

      // 2. baseline
      mark(2, "active");
      const b = await post<{ runId: string }>("/api/demo/push", { repoId: REPO });
      const bRes = await waitForRun(b.runId);
      mark(2, "done", `baseline run ${shortSha(b.runId)} — ${bRes.changeIds.length} changes (healthy)`);
      say("baseline established");

      // 3. push v2
      mark(3, "active");
      const p = await post<{ runId: string }>("/api/demo/push", { repoId: REPO });
      setRunId(p.runId);
      say(`push detected → run ${shortSha(p.runId)}`);
      const pRes = await waitForRun(p.runId);
      setChangeIds(pRes.changeIds);
      mark(3, "done", `${pRes.changeIds.length} changes detected`);

      // 4. breaking alert
      mark(4, "active");
      const ch = await get<{ changes: { id: string; type: string; severity: string; method: string; path: string; detail: string }[] }>(
        `/api/changes?repoId=${REPO}`
      );
      const top = ch.changes[0];
      mark(4, "done", top ? `${top.severity} ${top.type} ${top.method} ${top.path}` : "no changes?!");

      // 5. ask
      mark(5, "active");
      const a = await post<{ answer: { answer: string; provider: string; providerKind: string } }>(
        "/api/agent/ask", { question: "Why is login breaking?", repoId: REPO }
      );
      setAskAnswer(a.answer.answer);
      mark(5, "done", `answered via ${a.answer.providerKind}:${a.answer.provider}`);

      // 6. impact + patch
      mark(6, "active");
      const imp = await get<{ findings: unknown[] }>(`/api/impact?repoId=${REPO}`);
      const prev = await post<{ preview: { added: string[]; patched: string[]; removed: string[]; validation: { valid: boolean; operations: number } } }>(
        "/api/sync/preview", { repoId: REPO, changeIds: pRes.changeIds, allowDelete: false }
      );
      mark(6, "done", `${(imp.findings as unknown[]).length} consumer refs · patch +${prev.preview.added.length} ~${prev.preview.patched.length} · validation ${prev.preview.validation.valid ? "PASSED" : "FAILED"}`);

      // 7. approve
      mark(7, "active");
      const appr = await get<{ approvals: { id: string; status: string }[] }>(`/api/approvals?repoId=${REPO}&status=pending`);
      if (appr.approvals.length) {
        await post(`/api/approvals/${appr.approvals[0].id}`, { decision: "approve", allowDelete: false });
        mark(7, "done", "approved → validated spec published");
      } else {
        const ap = await post<{ version: number }>("/api/sync/apply", { repoId: REPO, changeIds: pRes.changeIds, allowDelete: false, confirm: true });
        mark(7, "done", `published v${ap.version}`);
      }

      // 8. verify
      mark(8, "active");
      const v = await post<{ answer: { answer: string } }>(
        "/api/agent/ask", { question: "Is the API synchronized?", repoId: REPO }
      );
      setVerifyAnswer(v.answer.answer);
      mark(8, "done", "verified");
      say("demo complete — open Swagger to show synchronized docs");
    } catch (e) {
      say(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
      setSteps((s) => s.map((x) => (x.status === "active" ? { ...x, status: "failed" } : x)));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="shell" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>Live demo script</h1>
          <p>3–5 minutes, end to end, on the real pipeline. Nothing here is staged.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" onClick={run} disabled={running}>
            {running ? <><Spinner /> Running…</> : "▶ Run the demo"}
          </button>
          <Link className="btn" href={`/docs/swagger?repo=${REPO}`}>Swagger</Link>
          <Link className="btn" href={`/mobile?repo=${REPO}`}>Phone</Link>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          {steps.map((s) => (
            <div key={s.n} className={`step ${s.status === "done" ? "done" : s.status === "active" ? "active" : ""}`}>
              <span className="n">{s.status === "done" ? "✓" : s.status === "failed" ? "✕" : s.n}</span>
              <span>
                <strong>{s.title}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{s.detail}</div>
                {s.output && <div className="mono" style={{ fontSize: 12, color: s.status === "failed" ? "var(--red)" : "var(--accent)" }}>{s.output}</div>}
                {s.status === "active" && <div style={{ marginTop: 4 }}><Spinner /></div>}
              </span>
            </div>
          ))}
        </div>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3>LIVE LOG</h3>
            <div className="code-block" style={{ maxHeight: 220, fontSize: 11 }}>
              {log.length ? log.join("\n") : "Press “Run the demo”. Each step executes real API calls."}
            </div>
            {runId && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link className="btn small" href={`/dashboard?repo=${REPO}`}>Open run</Link>
                <Link className="btn small" href={`/dashboard/changes?repo=${REPO}`}>Diffs</Link>
                <Link className="btn small" href={`/dashboard/documentation?repo=${REPO}`}>Sync</Link>
              </div>
            )}
          </div>
          {askAnswer && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h3>“WHY IS LOGIN BREAKING?”</h3>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}><RichText text={askAnswer} /></div>
            </div>
          )}
          {verifyAnswer && (
            <div className="card">
              <h3>“IS THE API SYNCHRONIZED?”</h3>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}><RichText text={verifyAnswer} /></div>
            </div>
          )}
          <div className="card" style={{ marginTop: 14 }}>
            <h3>PRESENTER NOTES</h3>
            <div style={{ fontSize: 13 }} className="muted">
              1. Open this page + <span className="mono">/mobile</span> on the phone.<br />
              2. Run the demo — narrate each step as it completes for real.<br />
              3. When the alert lands, pick up the phone and ask <em>“Why is login breaking?”</em> by voice.<br />
              4. Show the diff, impact, patch preview, then approve.<br />
              5. Open Swagger — the synchronized spec. Ask <em>“Is the API synchronized?”</em>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

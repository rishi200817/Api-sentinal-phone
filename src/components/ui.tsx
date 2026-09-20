/** Shared UI primitives (client components). */
"use client";

import React from "react";

export function Badge({ tone, children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`badge ${tone ?? ""}`}>{children}</span>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const tone =
    severity === "CRITICAL" ? "red" : severity === "HIGH" ? "red" : severity === "MEDIUM" ? "amber" : "green";
  return <Badge tone={tone}>{severity}</Badge>;
}

export function BreakingBadge({ breaking }: { breaking: string }) {
  const label = breaking.replace(/-/g, " ");
  const tone =
    breaking === "likely-breaking" ? "red" : breaking === "potentially-breaking" ? "amber" : breaking === "unclear" ? "violet" : "green";
  return <Badge tone={tone}>{label}</Badge>;
}

export function MethodTag({ method }: { method: string }) {
  return <strong className={`mono m-${method}`}>{method}</strong>;
}

export function LiveDot({ status, label }: { status: "live" | "off" | "warn"; label: string }) {
  return (
    <span className={`live-dot ${status === "live" ? "" : status}`} role="status" aria-label={label}>
      <span className="dot" aria-hidden /> {label}
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="loading" />;
}

export function Empty({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="big" aria-hidden>{icon}</div>
      <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: 13 }}>{hint}</div>}
    </div>
  );
}

/** Minimal safe markdown-lite renderer (code, bold, inline code, lists). No HTML injection. */
export function RichText({ text }: { text: string }) {
  const blocks = text.split(/```/);
  return (
    <>
      {blocks.map((b, i) => {
        if (i % 2 === 1) {
          const code = b.replace(/^[a-z]+\n/i, "");
          return (
            <pre key={i}><code>{code}</code></pre>
          );
        }
        return (
          <React.Fragment key={i}>
            {b.split("\n").map((line, j) => {
              if (/^\s*-\s+/.test(line)) {
                return <div key={j}>• {inline(line.replace(/^\s*-\s+/, ""))}</div>;
              }
              if (/^#{1,3}\s/.test(line)) {
                return <div key={j} style={{ fontWeight: 800, margin: "8px 0 4px" }}>{line.replace(/^#+\s/, "")}</div>;
              }
              if (!line.trim()) return <div key={j} style={{ height: 6 }} />;
              return <div key={j}>{inline(line)}</div>;
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}

function inline(line: string): React.ReactNode {
  // `code` and **bold** only — everything else is plain text (XSS-safe).
  const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

export function HealthRing({ score }: { score: number }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const color = score >= 85 ? "var(--accent)" : score >= 60 ? "var(--amber)" : "var(--red)";
  return (
    <div className="health-ring" role="img" aria-label={`health ${score} percent`}>
      <svg width="92" height="92">
        <circle cx="46" cy="46" r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="9" />
        <circle
          cx="46" cy="46" r={r} fill="none" stroke={color} strokeWidth="9"
          strokeLinecap="round" strokeDasharray={c}
          strokeDashoffset={c - (c * score) / 100}
        />
      </svg>
      <span className="val">{score}%</span>
    </div>
  );
}

export function StageTimeline({ stages }: { stages: { stage: string; status: string; detail?: string; startedAt?: string }[] }) {
  return (
    <div className="timeline">
      {stages.map((s) => (
        <div key={s.stage} className={`tl-step ${s.status === "done" ? "done" : s.status === "running" ? "running" : s.status === "failed" ? "failed" : ""}`}>
          <strong style={{ textTransform: "capitalize" }}>{s.stage.replace(/-/g, " ")}</strong>
          <span className="when">{s.status}</span>
          {s.detail && <div className="detail">{s.detail}</div>}
        </div>
      ))}
    </div>
  );
}

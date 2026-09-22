/** Phone console: phone-first workflow, share bridge, Office Kit guidance. */
"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { get } from "@/lib/client";
import { Badge, Spinner } from "@/components/ui";

function PhoneInner() {
  const [shareSupported, setShareSupported] = useState(false);
  const [notifSupported, setNotifSupported] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [msg, setMsg] = useState("");
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    setShareSupported(typeof navigator !== "undefined" && "share" in navigator);
    setNotifSupported(typeof window !== "undefined" && "Notification" in window);
    setVoiceSupported(typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window));
    get<{ unread: number }>("/api/notifications").then((d) => setUnread(d.unread)).catch(() => {});
  }, []);

  async function share() {
    const url = `${window.location.origin}/mobile`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "API Sentinel Phone", text: "Monitor APIs from your phone", url });
      } else {
        await navigator.clipboard.writeText(url);
        setMsg("Phone URL copied to clipboard.");
      }
    } catch {
      setMsg("Share dismissed.");
    }
  }

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(() => setMsg(`${label} copied.`));
  }

  return (
    <div className="shell">
      <div className="page-head">
        <div>
          <h1>Phone Console</h1>
          <p>Laptop does deep analysis — the phone monitors, asks, reviews, and approves.</p>
        </div>
        <Link href="/mobile" className="btn primary">Open phone experience</Link>
      </div>
      {msg && <div className="alert green">{msg}</div>}

      <div className="grid cols-2">
        <div className="card">
          <h3>PHONE ↔ WORKSPACE</h3>
          <div className="step done"><span className="n">1</span><span><strong>Laptop:</strong> connect GitHub, run deep analysis, review OpenAPI diffs, publish docs.</span></div>
          <div className="step done"><span className="n">2</span><span><strong>Phone:</strong> gets the breaking-change alert with severity and evidence.</span></div>
          <div className="step done"><span className="n">3</span><span><strong>Phone:</strong> tap or speak — “Why is login breaking?” — Sentinel answers from live data.</span></div>
          <div className="step done"><span className="n">4</span><span><strong>Phone:</strong> review the patch, approve or reject the sync.</span></div>
          <div className="step done"><span className="n">5</span><span><strong>Both:</strong> live Swagger/Redoc reflect the published spec instantly.</span></div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn" onClick={share}>{shareSupported ? "Share phone link" : "Copy phone link"}</button>
            <button className="btn" onClick={() => copy(`${typeof window !== "undefined" ? window.location.origin : ""}/docs/swagger`, "Swagger URL")}>Copy Swagger URL</button>
            <Link className="btn" href="/mobile">Open /mobile</Link>
          </div>
        </div>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3>DEVICE CAPABILITIES <span className="sub">detected live in this browser</span></h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Badge tone={notifSupported ? "green" : ""}>notifications {notifSupported ? "supported" : "unsupported"}</Badge>
              <Badge tone={voiceSupported ? "green" : ""}>voice input {voiceSupported ? "supported" : "unsupported"}</Badge>
              <Badge tone={shareSupported ? "green" : ""}>native share {shareSupported ? "supported" : "fallback: copy"}</Badge>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Unsupported capabilities degrade gracefully and say so — Sentinel never pretends a notification was delivered or voice was heard.
              {unread > 0 ? ` You have ${unread} unread alert(s) waiting on the phone.` : ""}
            </p>
          </div>
          <div className="card">
            <h3>OFFICE KIT WORKFLOW</h3>
            <p className="muted" style={{ fontSize: 13 }}>
              Sentinel is web-native, so any phone↔laptop bridge that shares links, files, or screen works:
              open the same deployment URL on both devices — state is server-side, so approvals on the phone
              instantly reflect on the laptop dashboard.
            </p>
            <div className="step"><span className="n">A</span><span>Open this deployment on the laptop (dashboard) and the phone (<span className="mono">/mobile</span>).</span></div>
            <div className="step"><span className="n">B</span><span>Push code → webhook → both screens update from the same analysis run.</span></div>
            <div className="step"><span className="n">C</span><span>Use the platform share/clipboard flow to move Swagger URLs, patch previews, and migration guides between devices.</span></div>
            <div className="alert cyan" style={{ marginBottom: 0 }}>
              <strong>Office Kit pairing status: not detected.</strong> Sentinel does not invent proprietary pairing APIs.
              If the event provides an Office Kit bridge, use it to share the live URLs above — the app is ready for it.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PhonePage() {
  return <Suspense fallback={<div className="shell"><div className="card"><Spinner /> Loading…</div></div>}><PhoneInner /></Suspense>;
}

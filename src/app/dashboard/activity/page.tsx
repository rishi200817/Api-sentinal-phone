/** Audit log + notification center. */
"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { get, patch } from "@/lib/client";
import { RepoPicker, useRepos } from "@/components/repo-context";
import { Badge, Empty, Spinner } from "@/components/ui";

interface Event { id: string; kind: string; actor: string; message: string; createdAt: string; analysisId?: string }
interface Notif { id: string; kind: string; title: string; body: string; read: boolean; createdAt: string; analysisId?: string }

function ActivityInner() {
  const { selectedId } = useRepos();
  const [events, setEvents] = useState<Event[]>([]);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [browserPerm, setBrowserPerm] = useState<string>("unknown");
  const [browserSupported, setBrowserSupported] = useState(false);

  const load = useCallback(async () => {
    const [e, n] = await Promise.all([
      get<{ events: Event[] }>(`/api/activity${selectedId ? `?repoId=${selectedId}` : ""}`),
      get<{ notifications: Notif[]; unread: number }>("/api/notifications"),
    ]);
    setEvents(e.events);
    setNotifs(n.notifications);
    setUnread(n.unread);
  }, [selectedId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setBrowserSupported(true);
      setBrowserPerm(Notification.permission);
    }
  }, []);

  async function enableBrowser() {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setBrowserPerm(p);
    if (p === "granted") {
      new Notification("API Sentinel", { body: "Browser alerts enabled. Breaking changes will notify you here." });
    }
  }

  async function markAll() {
    await patch("/api/notifications", { markAllRead: true });
    await load();
  }

  async function markOne(id: string) {
    await patch("/api/notifications", { id });
    await load();
  }

  return (
    <div className="shell">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p>Full audit trail plus the notification center ({unread} unread).</p>
        </div>
        <RepoPicker />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>NOTIFICATIONS</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <button className="btn small" onClick={markAll}>Mark all read</button>
            {browserSupported ? (
              browserPerm === "granted"
                ? <Badge tone="green">browser alerts on</Badge>
                : <button className="btn small" onClick={enableBrowser}>Enable browser alerts</button>
            ) : (
              <span className="muted" style={{ fontSize: 12 }}>Browser notifications not supported here — in-app center always works.</span>
            )}
          </div>
          {!notifs.length && <Empty icon="🔕" title="No notifications" hint="Breaking changes, validations, and publishes appear here." />}
          {notifs.slice(0, 20).map((n) => (
            <div
              key={n.id}
              onClick={() => { if (!n.read) void markOne(n.id); }}
              style={{ padding: "9px 0", borderBottom: "1px solid var(--border)", fontSize: 13, opacity: n.read ? 0.65 : 1, cursor: n.read ? "default" : "pointer" }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Badge tone={n.kind === "breaking" ? "red" : n.kind === "validation" ? "amber" : n.kind === "sync" ? "green" : "cyan"}>{n.kind}</Badge>
                <strong>{n.title}</strong>
                {!n.read && <span className="badge green">new</span>}
              </div>
              <div className="muted">{n.body}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>{new Date(n.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>AUDIT LOG</h3>
          {!events.length && <Empty icon="📜" title="No events" hint="Webhook, analysis, AI, sync, and approval events are recorded here." />}
          {events.slice(0, 60).map((e) => (
            <div key={e.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Badge>{e.kind}</Badge>
                <span className="muted">by {e.actor}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--faint)", marginLeft: "auto" }}>
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>
              <div style={{ marginTop: 3 }}>{e.message}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ActivityPage() {
  return <Suspense fallback={<div className="shell"><div className="card"><Spinner /> Loading…</div></div>}><ActivityInner /></Suspense>;
}

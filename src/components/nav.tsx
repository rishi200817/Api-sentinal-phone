/** Top navigation (desktop) + bottom navigation (mobile). */
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { get } from "@/lib/client";
import { useAuth } from "./auth-context";
import { LiveDot } from "./ui";

const LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/repositories", label: "Repositories" },
  { href: "/dashboard/changes", label: "API Changes" },
  { href: "/dashboard/endpoints", label: "Endpoints" },
  { href: "/dashboard/impact", label: "Impact" },
  { href: "/dashboard/agent", label: "AI Agent" },
  { href: "/dashboard/documentation", label: "Documentation" },
  { href: "/dashboard/activity", label: "Activity" },
  { href: "/dashboard/phone", label: "Phone Console" },
  { href: "/dashboard/settings", label: "Settings" },
];

const MOBILE_LINKS = [
  { href: "/mobile", label: "Home", ico: "●" },
  { href: "/mobile/changes", label: "Changes", ico: "◈" },
  { href: "/mobile/ask", label: "Ask", ico: "✦" },
  { href: "/mobile/docs", label: "Docs", ico: "▤" },
  { href: "/mobile/more", label: "More", ico: "⋯" },
];

export function TopNav() {
  const pathname = usePathname();
  const [live, setLive] = useState<"live" | "off" | "warn">("off");
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const d = await get<{ repos: { status: string }[]; unread: number }>("/api/overview");
        if (stop) return;
        const anyLive = (d.repos ?? []).some((r) => r.status === "connected");
        const anyErr = (d.repos ?? []).some((r) => r.status === "error");
        setLive(anyErr ? "warn" : anyLive ? "live" : "off");
        setUnread(d.unread ?? 0);
      } catch {
        if (!stop) setLive("off");
      }
    }
    void poll();
    const t = setInterval(poll, 15000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  if (pathname?.startsWith("/mobile")) return null;
  return (
    <nav className="topnav" aria-label="primary">
      <div className="topnav-inner">
        <Link href="/" className="brand" aria-label="API Sentinel home">
          <span className="brand-mark" aria-hidden>S</span>
          <span>API Sentinel<small>change intelligence</small></span>
        </Link>
        <div className="nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={pathname === l.href ? "active" : ""}>
              {l.label}
            </Link>
          ))}
        </div>
        <div className="nav-right">
          {unread > 0 && (
            <Link href="/dashboard/activity" className="badge amber" aria-label={`${unread} unread notifications`}>
              {unread} new
            </Link>
          )}
          <LiveDot
            status={live}
            label={live === "live" ? "● LIVE" : live === "warn" ? "● DEGRADED" : "○ IDLE"}
          />
          <Link href="/mobile" className="btn small">Phone</Link>
          <AuthArea />
        </div>
      </div>
    </nav>
  );
}

function AuthArea() {
  const { user, loading, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  if (loading) return null;
  if (!user) {
    return <Link href="/login" className="btn small primary">Sign in</Link>;
  }
  const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();
  return (
    <>
      <span className="auth-user" title={user.email}>
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="auth-avatar" src={user.avatarUrl} alt="" />
        ) : (
          <span className="auth-avatar" aria-hidden>{initial}</span>
        )}
        {user.name}
      </span>
      <button
        className="btn small"
        disabled={busy}
        onClick={() => { setBusy(true); void logout(); }}
      >
        Log out
      </button>
    </>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const search = useSearchParams();
  if (!pathname?.startsWith("/mobile")) return null;
  const repo = search?.get("repo");
  const q = repo ? `?repo=${encodeURIComponent(repo)}` : "";
  return (
    <nav className="bottom-nav" aria-label="mobile">
      {MOBILE_LINKS.map((l) => (
        <Link key={l.href} href={`${l.href}${q}`} className={pathname === l.href ? "active" : ""}>
          <span className="ico" aria-hidden>{l.ico}</span>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

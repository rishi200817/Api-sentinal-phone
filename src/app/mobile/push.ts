/** Real browser push-style alerts via the Notification API (opt-in, honest). */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { get } from "@/lib/client";

export function usePushAlerts() {
  const [supported] = useState(
    () => typeof window !== "undefined" && "Notification" in window
  );
  const [permission, setPermission] = useState<string>(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "denied"
  );
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const enable = useCallback(async () => {
    if (!("Notification" in window)) return "denied" as const;
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p === "granted") {
      new Notification("API Sentinel", {
        body: "Alerts enabled. Breaking API changes will notify you here.",
      });
    }
    return p;
  }, []);

  useEffect(() => {
    if (!supported || permission !== "granted") return;
    let stop = false;
    async function poll() {
      try {
        const d = await get<{ notifications: { id: string; kind: string; title: string; body: string }[] }>(
          "/api/notifications"
        );
        if (stop) return;
        if (!primed.current) {
          // Don't replay history — only new arrivals from here on.
          for (const n of d.notifications) seen.current.add(n.id);
          primed.current = true;
          return;
        }
        for (const n of d.notifications) {
          if (seen.current.has(n.id)) continue;
          seen.current.add(n.id);
          if (n.kind === "breaking" || n.kind === "validation") {
            new Notification(`API Sentinel — ${n.title}`, { body: n.body.slice(0, 180) });
          }
        }
      } catch {
        /* polling failure is silent; in-app center remains source of truth */
      }
    }
    const t = setInterval(poll, 8000);
    void poll();
    return () => { stop = true; clearInterval(t); };
  }, [supported, permission]);

  return { supported, permission, enable };
}

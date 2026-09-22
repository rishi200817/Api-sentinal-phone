/** Session state hook: current user + provider availability. */
"use client";

import { useCallback, useEffect, useState } from "react";
import { get, post } from "@/lib/client";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  providers: ("password" | "github")[];
  createdAt: string;
}

export interface ProvidersStatus {
  credentials: boolean;
  github: boolean;
}

export function useAuth() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [providers, setProviders] = useState<ProvidersStatus>({ credentials: true, github: false });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const d = await get<{ user: SessionUser | null; providers: ProvidersStatus }>("/api/auth/me");
      setUser(d.user);
      setProviders(d.providers);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await post("/api/auth/logout");
    } finally {
      setUser(null);
      window.location.href = "/";
    }
  }, []);

  return { user, providers, loading, refresh, logout };
}

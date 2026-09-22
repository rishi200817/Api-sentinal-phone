/** Shared repository picker bound to the URL (?repo=). */
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { get } from "@/lib/client";

export interface RepoRow {
  id: string;
  name: string;
  owner: string;
  repo: string;
  url: string;
  defaultBranch: string;
  provider: string;
  status: string;
  statusMessage?: string;
  lastSha: string | null;
  lastAnalysisId: string | null;
  webhookEnabled: boolean;
  webhookSecretSet: boolean;
  autoSyncPolicy: string;
}

export function useRepos() {
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    try {
      const d = await get<{ repos: RepoRow[] }>("/api/repos");
      setRepos(d.repos);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectedId = search?.get("repo") ?? repos[0]?.id ?? null;
  const selected = repos.find((r) => r.id === selectedId) ?? repos[0] ?? null;

  const select = useCallback((id: string) => {
    const params = new URLSearchParams(search?.toString() ?? "");
    params.set("repo", id);
    router.push(`${pathname}?${params.toString()}`);
  }, [router, pathname, search]);

  return { repos, loading, selected, selectedId: selected?.id ?? null, select, refresh };
}

export function RepoPicker({ compact }: { compact?: boolean }) {
  const { repos, loading, selected, select } = useRepos();
  if (loading) return <span className="muted" style={{ fontSize: 13 }}>Loading repos…</span>;
  if (!repos.length) return <span className="muted" style={{ fontSize: 13 }}>No repositories yet.</span>;
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }} className="muted">
      {!compact && "Repository"}
      <select
        className="select"
        style={{ width: "auto", minWidth: 220 }}
        value={selected?.id ?? ""}
        onChange={(e) => select(e.target.value)}
        aria-label="Select repository"
      >
        {repos.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} {r.provider === "demo" ? "(demo)" : ""} · {r.status}
          </option>
        ))}
      </select>
    </label>
  );
}

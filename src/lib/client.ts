/** Typed browser client for the Sentinel API. */
"use client";

export class ApiError extends Error {
  status: number;
  loginRequired: boolean;
  constructor(message: string, status: number, loginRequired: boolean) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.loginRequired = loginRequired;
  }
}

function maybeRedirectToLogin(path: string, loginRequired: boolean) {
  if (!loginRequired || typeof window === "undefined") return;
  // Never redirect auth calls or auth pages (the forms handle errors inline).
  if (path.startsWith("/api/auth/")) return;
  const here = window.location.pathname;
  if (here === "/login" || here === "/signup") return;
  const next = encodeURIComponent(here + window.location.search);
  window.location.href = `/login?next=${next}`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: T;
    error?: string;
    loginRequired?: boolean;
  };
  if (!res.ok || json.ok === false) {
    const loginRequired = res.status === 401 && json.loginRequired === true;
    maybeRedirectToLogin(path, loginRequired);
    throw new ApiError(json.error || `Request failed (${res.status}).`, res.status, loginRequired);
  }
  return json.data as T;
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
export const patch = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });

export function shortSha(sha?: string | null): string {
  if (!sha) return "—";
  if (sha.startsWith("demo-")) return sha;
  return sha.slice(0, 7);
}

export function timeAgo(iso?: string): string {
  if (!iso) return "never";
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

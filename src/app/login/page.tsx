/** Login: email+password or GitHub OAuth. Honors ?next= and ?error=. */
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { post } from "@/lib/client";
import { Spinner } from "@/components/ui";

const OAUTH_ERRORS: Record<string, string> = {
  "github-not-configured":
    "GitHub login isn't set up on this server yet (missing GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET). Use email + password for now.",
  "github-denied": "GitHub sign-in was cancelled. Try again when ready.",
  "invalid-state": "That sign-in attempt expired. Please try again.",
  "github-failed": "GitHub sign-in failed. Try again, or use email + password.",
  "email-taken":
    "An account with that email already exists. Log in with your password — we'll link GitHub automatically when the address matches.",
  "no-email": "GitHub didn't share an email address, so we couldn't create your account.",
};

function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, providers, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(search?.get("error") ? OAUTH_ERRORS[search.get("error")!] ?? "Sign-in failed. Try again." : "");
  const next = search?.get("next") || "/dashboard";

  if (user) {
    router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    return (
      <div className="auth-wrap"><div className="card auth-card"><Spinner /> Redirecting…</div></div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/login", { email, password });
      await refresh();
      router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-brand"><span className="brand-mark" aria-hidden>S</span></div>
        <h1>Welcome back</h1>
        <p className="muted">Log in to connect repos, run analyses, and publish docs.</p>
        {error && <div className="alert red">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <button className="btn primary block" type="submit" disabled={busy}>
            {busy ? <Spinner /> : "Log in"}
          </button>
        </form>
        <div className="auth-divider"><span>or</span></div>
        {providers.github ? (
          <a className="btn block" href={`/api/auth/github?next=${encodeURIComponent(next)}`}>
            Continue with GitHub
          </a>
        ) : (
          <button className="btn block" type="button" disabled title="Server is missing GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET">
            GitHub login not configured
          </button>
        )}
        <p className="muted auth-foot">
          New here? <Link href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="auth-wrap"><div className="card auth-card"><Spinner /> Loading…</div></div>}>
      <LoginInner />
    </Suspense>
  );
}

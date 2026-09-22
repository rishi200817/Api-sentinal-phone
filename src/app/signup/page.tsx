/** Sign-up: create an account with email+password. */
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { post } from "@/lib/client";
import { Spinner } from "@/components/ui";

function SignupInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, refresh } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
      await post("/api/auth/signup", { name, email, password });
      await refresh();
      router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-brand"><span className="brand-mark" aria-hidden>S</span></div>
        <h1>Create your account</h1>
        <p className="muted">One account for dashboards, approvals, and publishing.</p>
        {error && <div className="alert red">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" className="input" type="text" autoComplete="name"
              value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="new-password" required
              minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
            <div className="hint">Stored as a salted scrypt hash — never in plain text.</div>
          </div>
          <button className="btn primary block" type="submit" disabled={busy}>
            {busy ? <Spinner /> : "Create account"}
          </button>
        </form>
        <p className="muted auth-foot">
          Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`}>Log in</Link>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="auth-wrap"><div className="card auth-card"><Spinner /> Loading…</div></div>}>
      <SignupInner />
    </Suspense>
  );
}

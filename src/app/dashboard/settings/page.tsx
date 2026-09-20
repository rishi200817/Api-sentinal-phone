/** Settings: tokens, providers, policies. Secrets never round-trip to the UI. */
"use client";

import { Suspense, useEffect, useState } from "react";
import { get, post } from "@/lib/client";
import { Badge, Spinner } from "@/components/ui";

interface Settings {
  githubTokenSet: boolean; defaultBranch: string; webhookSecretSet: boolean;
  aiProviderPreference: string; localAiUrl: string; localAiModel: string;
  remoteAiUrl: string; remoteAiModel: string; remoteAiKeySet: boolean;
  autoSyncPolicy: string; notificationsEnabled: boolean; demoMode: boolean;
  openapiStrictness: string;
}

function SettingsInner() {
  const [s, setS] = useState<Settings | null>(null);
  const [f, setF] = useState({ githubToken: "", webhookSecret: "", remoteAiKey: "", localAiUrl: "", localAiModel: "", remoteAiUrl: "", remoteAiModel: "", defaultBranch: "" });
  const [prefs, setPrefs] = useState({ aiProviderPreference: "auto", autoSyncPolicy: "manual", notificationsEnabled: true, openapiStrictness: "standard" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const d = await get<{ settings: Settings }>("/api/settings");
    setS(d.settings);
    setF((old) => ({
      ...old,
      localAiUrl: d.settings.localAiUrl, localAiModel: d.settings.localAiModel,
      remoteAiUrl: d.settings.remoteAiUrl, remoteAiModel: d.settings.remoteAiModel,
      defaultBranch: d.settings.defaultBranch,
    }));
    setPrefs({
      aiProviderPreference: d.settings.aiProviderPreference,
      autoSyncPolicy: d.settings.autoSyncPolicy,
      notificationsEnabled: d.settings.notificationsEnabled,
      openapiStrictness: d.settings.openapiStrictness,
    });
  }
  useEffect(() => { void load().catch((e) => setError(e.message)); }, []);

  async function save(body: Record<string, unknown>, label: string) {
    setBusy(true); setError(""); setMsg("");
    try {
      await post("/api/settings", body);
      setMsg(`${label} saved.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!s) return <div className="shell"><div className="card"><Spinner /> Loading settings…</div></div>;

  return (
    <div className="shell" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Secrets are stored server-side only. The UI shows set/not-set — never values.</p>
        </div>
      </div>
      {error && <div className="alert red">{error}</div>}
      {msg && <div className="alert green">{msg}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>GITHUB</h3>
        <div className="field">
          <label>Personal access token {s.githubTokenSet ? <Badge tone="green">set</Badge> : <Badge>not set</Badge>}</label>
          <input className="input mono" type="password" autoComplete="off" placeholder={s.githubTokenSet ? "•••••• (enter a new token to replace, or blank to clear)" : "ghp_… (repo scope for private repos)"}
            value={f.githubToken} onChange={(e) => setF({ ...f, githubToken: e.target.value })} />
          <div className="hint">Needed for private repos and higher rate limits. Public repos work without it.</div>
        </div>
        <div className="field">
          <label>Default branch fallback</label>
          <input className="input mono" value={f.defaultBranch} onChange={(e) => setF({ ...f, defaultBranch: e.target.value })} />
        </div>
        <div className="field">
          <label>Webhook secret {s.webhookSecretSet ? <Badge tone="green">set</Badge> : <Badge>not set</Badge>}</label>
          <input className="input mono" type="password" autoComplete="off" placeholder="Must match the GitHub webhook secret"
            value={f.webhookSecret} onChange={(e) => setF({ ...f, webhookSecret: e.target.value })} />
          <div className="hint">Without a secret, all webhook deliveries are rejected. Configure the same value in GitHub → Settings → Webhooks.</div>
        </div>
        <button className="btn primary" disabled={busy} onClick={() => save({ githubToken: f.githubToken || undefined, webhookSecret: f.webhookSecret || undefined, defaultBranch: f.defaultBranch }, "GitHub settings")}>
          {busy ? <Spinner /> : "Save GitHub settings"}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3>AI PROVIDERS</h3>
        <div className="field">
          <label>Provider preference</label>
          <select className="select" value={prefs.aiProviderPreference} onChange={(e) => setPrefs({ ...prefs, aiProviderPreference: e.target.value })}>
            <option value="auto">Auto (local → remote → deterministic)</option>
            <option value="local">Local only (+ deterministic fallback)</option>
            <option value="remote">Remote only (+ deterministic fallback)</option>
            <option value="deterministic">Deterministic only</option>
          </select>
        </div>
        <div className="grid cols-2">
          <div className="field">
            <label>Local runtime URL (Ollama-compatible)</label>
            <input className="input mono" value={f.localAiUrl} onChange={(e) => setF({ ...f, localAiUrl: e.target.value })} />
          </div>
          <div className="field">
            <label>Local model</label>
            <input className="input mono" value={f.localAiModel} onChange={(e) => setF({ ...f, localAiModel: e.target.value })} />
          </div>
        </div>
        <div className="grid cols-2">
          <div className="field">
            <label>Remote base URL (OpenAI-compatible, optional)</label>
            <input className="input mono" placeholder="https://…" value={f.remoteAiUrl} onChange={(e) => setF({ ...f, remoteAiUrl: e.target.value })} />
          </div>
          <div className="field">
            <label>Remote model</label>
            <input className="input mono" value={f.remoteAiModel} onChange={(e) => setF({ ...f, remoteAiModel: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Remote API key {s.remoteAiKeySet ? <Badge tone="green">set</Badge> : <Badge>not set</Badge>}</label>
          <input className="input mono" type="password" autoComplete="off" placeholder="Leave blank to keep current"
            value={f.remoteAiKey} onChange={(e) => setF({ ...f, remoteAiKey: e.target.value })} />
        </div>
        <button className="btn primary" disabled={busy} onClick={() => save({
          aiProviderPreference: prefs.aiProviderPreference,
          localAiUrl: f.localAiUrl, localAiModel: f.localAiModel,
          remoteAiUrl: f.remoteAiUrl, remoteAiModel: f.remoteAiModel,
          ...(f.remoteAiKey ? { remoteAiKey: f.remoteAiKey } : {}),
        }, "AI settings")}>
          {busy ? <Spinner /> : "Save AI settings"}
        </button>
      </div>

      <div className="card">
        <h3>POLICIES</h3>
        <div className="grid cols-2">
          <div className="field">
            <label>Default auto-sync policy (new repos)</label>
            <select className="select" value={prefs.autoSyncPolicy} onChange={(e) => setPrefs({ ...prefs, autoSyncPolicy: e.target.value })}>
              <option value="manual">Manual (approval)</option>
              <option value="auto-safe">Auto (safe only)</option>
              <option value="auto-all">Auto (all valid)</option>
            </select>
          </div>
          <div className="field">
            <label>OpenAPI strictness</label>
            <select className="select" value={prefs.openapiStrictness} onChange={(e) => setPrefs({ ...prefs, openapiStrictness: e.target.value })}>
              <option value="standard">Standard</option>
              <option value="strict">Strict (summaries required)</option>
            </select>
          </div>
        </div>
        <label className="muted" style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <input type="checkbox" checked={prefs.notificationsEnabled} onChange={(e) => setPrefs({ ...prefs, notificationsEnabled: e.target.checked })} />
          In-app notifications enabled
        </label>
        <button className="btn primary" disabled={busy} onClick={() => save({
          autoSyncPolicy: prefs.autoSyncPolicy, openapiStrictness: prefs.openapiStrictness,
          notificationsEnabled: prefs.notificationsEnabled,
        }, "Policies")}>
          {busy ? <Spinner /> : "Save policies"}
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return <Suspense fallback={<div className="shell"><div className="card"><Spinner /> Loading…</div></div>}><SettingsInner /></Suspense>;
}

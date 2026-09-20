/**
 * Local/open-source AI transport.
 * Speaks to a local model runtime over HTTP (Ollama-compatible chat API by
 * default: POST {base}/api/chat with {model, messages, stream:false}).
 *
 * Nothing is faked: if the runtime is unreachable, status() reports
 * NOT CONNECTED and the orchestrator falls back deterministically.
 */
import { assertSafeFetchUrl } from "../security/guards";

export interface LocalAIConfig {
  baseUrl: string; // e.g. http://localhost:11434
  model: string; // e.g. llama3.1
  timeoutMs?: number;
}

export function localAIConfigFromEnv(): LocalAIConfig {
  return {
    baseUrl: process.env.SENTINEL_LOCAL_AI_URL || "http://localhost:11434",
    model: process.env.SENTINEL_LOCAL_AI_MODEL || "llama3.1",
    timeoutMs: Number(process.env.SENTINEL_LOCAL_AI_TIMEOUT_MS || 30000),
  };
}

function extraHostsFor(url: string): string[] {
  try {
    return [new URL(url).hostname];
  } catch {
    return [];
  }
}

export async function probeLocalAI(cfg: LocalAIConfig): Promise<{
  ok: boolean;
  detail: string;
  latencyMs: number;
}> {
  const t0 = Date.now();
  try {
    const url = `${cfg.baseUrl.replace(/\/$/, "")}/api/tags`;
    assertSafeFetchUrl(url, extraHostsFor(cfg.baseUrl));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(cfg.timeoutMs ?? 30000, 8000));
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      const latencyMs = Date.now() - t0;
      if (!res.ok) {
        return { ok: false, detail: `Runtime responded HTTP ${res.status} at ${cfg.baseUrl}.`, latencyMs };
      }
      let models: string[] = [];
      try {
        const j = (await res.json()) as { models?: { name?: string }[] };
        models = (j.models ?? []).map((m) => m.name ?? "?").filter(Boolean);
      } catch {
        /* ignore */
      }
      const hasModel = models.some((m) => m.startsWith(cfg.model));
      return {
        ok: true,
        detail: hasModel
          ? `Connected to ${cfg.baseUrl} · model '${cfg.model}' available.`
          : `Connected to ${cfg.baseUrl} · model '${cfg.model}' not listed (${models.slice(0, 4).join(", ") || "no models reported"}).`,
        latencyMs,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return {
      ok: false,
      detail: `Local runtime unreachable at ${cfg.baseUrl} (${err instanceof Error ? err.message : String(err)}).`,
      latencyMs: Date.now() - t0,
    };
  }
}

export async function chatLocalAI(
  cfg: LocalAIConfig,
  messages: { role: string; content: string; images?: string[] }[]
): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/api/chat`;
  assertSafeFetchUrl(url, extraHostsFor(cfg.baseUrl));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 30000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.model, messages, stream: false }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Local runtime HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const j = (await res.json()) as { message?: { content?: string }; error?: string };
    if (j.error) throw new Error(`Local runtime error: ${j.error}`);
    const content = j.message?.content?.trim();
    if (!content) throw new Error("Local runtime returned an empty response.");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Local + Remote provider adapters.
 * - LocalAIProvider: open-source runtime via local-ai transport (Ollama API).
 * - RemoteAIProvider: OpenAI-compatible chat-completions endpoint used only
 *   as an explicit development fallback (env-configured).
 * Both are grounded: prompts embed the deterministic analysis context and
 * untrusted repository content is wrapped as DATA.
 */
import type {
  AgentAnswer,
  ApiChange,
  ProviderStatus,
  SentinelContext,
} from "../types";
import type { AIProvider } from "./providers";
import { buildContextBlock, systemPrompt } from "./providers";
import { wrapUntrusted } from "../security/guards";
import {
  chatLocalAI,
  localAIConfigFromEnv,
  probeLocalAI,
  type LocalAIConfig,
} from "../local-ai/transport";

export function stripDataUrlPrefix(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

/** Ollama vision format: images[] (base64) on the user message. */
function attachOllamaImage(
  messages: { role: string; content: string }[],
  imageDataUrl: string
): { role: string; content: string; images?: string[] }[] {
  return messages.map((m, i) =>
    i === messages.length - 1 && m.role === "user"
      ? { ...m, images: [stripDataUrlPrefix(imageDataUrl)] }
      : m
  );
}

function ctxPrompt(instruction: string, ctx: SentinelContext, extra?: string): { role: string; content: string }[] {
  return [
    { role: "system", content: systemPrompt() },
    {
      role: "user",
      content: [
        instruction,
        "",
        "ANALYSIS CONTEXT (authoritative facts):",
        wrapUntrusted("CONTEXT", buildContextBlock(ctx)),
        extra ? `\n${extra}` : "",
      ].join("\n"),
    },
  ];
}

export class LocalAIProvider implements AIProvider {
  id = "local";
  kind = "local" as const;
  label = "Local / open-source model";
  private cfg: LocalAIConfig;

  constructor(cfg?: Partial<LocalAIConfig>) {
    this.cfg = { ...localAIConfigFromEnv(), ...cfg };
  }

  async status(): Promise<ProviderStatus> {
    const r = await probeLocalAI(this.cfg);
    return {
      id: this.id,
      kind: this.kind,
      connected: r.ok,
      label: r.ok ? `Local model (${this.cfg.model})` : "Local model: NOT CONNECTED",
      detail: r.detail,
      latencyMs: r.latencyMs,
    };
  }

  private chat(messages: { role: string; content: string }[]): Promise<string> {
    return chatLocalAI(this.cfg, messages);
  }

  async explainChange(change: ApiChange, ctx: SentinelContext): Promise<string> {
    return this.chat(
      ctxPrompt(
        `Explain this API change to the owning engineer: ${change.type} ${change.method} ${change.path}. Cover: what changed, why it matters, who may be affected, and the recommended next step. Use ONLY the context facts.`,
        ctx
      )
    );
  }

  async answerQuestion(
    question: string,
    ctx: SentinelContext,
    imageDataUrl?: string
  ): Promise<Omit<AgentAnswer, "provider" | "providerKind" | "latencyMs">> {
    const messages = ctxPrompt(
      imageDataUrl
        ? `A photo is attached. First transcribe any API-relevant content visible (endpoints, methods, status codes, JSON fields), then answer using the analysis context. If the image shows nothing API-relevant, say so.`
        : `Answer this developer question using ONLY the analysis context. Cite endpoints as METHOD /path and sources as file:line. If the context lacks the answer, say so.`,
      ctx,
      `USER QUESTION:\n${wrapUntrusted("QUESTION", question.slice(0, 2000))}`
    );
    const answer = await chatLocalAI(
      this.cfg,
      imageDataUrl ? attachOllamaImage(messages, imageDataUrl) : messages
    );
    return {
      answer,
      grounded: true,
      evidence: ctx.changes.slice(0, 5).flatMap((c) => [
        { label: "ENDPOINT", ref: `${c.method} ${c.path}` },
      ]),
      actions: [
        { id: "impact", label: "Show impact" },
        { id: "migration", label: "Generate migration" },
      ],
    };
  }

  async generateMigration(change: ApiChange, ctx: SentinelContext): Promise<string> {
    return this.chat(
      ctxPrompt(
        `Write concise client-migration steps for ${change.type} ${change.method} ${change.path}. Include before/after payload snippets derived ONLY from the context.`,
        ctx
      )
    );
  }

  async summarize(text: string, ctx: SentinelContext): Promise<string> {
    return this.chat(
      ctxPrompt(`Summarize the following in 3 sentences for a busy engineer:`, ctx, wrapUntrusted("TEXT", text.slice(0, 4000)))
    );
  }

  async generateDescription(change: ApiChange, ctx: SentinelContext): Promise<string> {
    return this.chat(
      ctxPrompt(
        `Write a one-paragraph OpenAPI operation description for ${change.method} ${change.path} from the context facts. No invented fields.`,
        ctx
      )
    );
  }
}

export interface RemoteAIConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

export function remoteAIConfigFromEnv(): RemoteAIConfig | null {
  const baseUrl = process.env.SENTINEL_REMOTE_AI_URL || "";
  const apiKey = process.env.SENTINEL_REMOTE_AI_KEY || "";
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl,
    model: process.env.SENTINEL_REMOTE_AI_MODEL || "gpt-4o-mini",
    apiKey,
    timeoutMs: Number(process.env.SENTINEL_REMOTE_AI_TIMEOUT_MS || 30000),
  };
}

async function chatRemote(
  cfg: RemoteAIConfig,
  messages: { role: string; content: string }[]
): Promise<string> {
  // OpenAI-compatible endpoint; host allowlist = the configured host.
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const { assertSafeFetchUrl } = await import("../security/guards");
  assertSafeFetchUrl(url, [new URL(cfg.baseUrl).hostname]);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2 }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Remote AI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const j = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = j.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Remote AI returned an empty response.");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export class RemoteAIProvider implements AIProvider {
  id = "remote";
  kind = "remote" as const;
  label = "Remote model (dev fallback)";
  private cfg: RemoteAIConfig | null;

  constructor(cfg?: RemoteAIConfig | null) {
    this.cfg = cfg === undefined ? remoteAIConfigFromEnv() : cfg;
  }

  async status(): Promise<ProviderStatus> {
    if (!this.cfg) {
      return {
        id: this.id,
        kind: this.kind,
        connected: false,
        label: "Remote model: NOT CONFIGURED",
        detail: "Set SENTINEL_REMOTE_AI_URL + SENTINEL_REMOTE_AI_KEY to enable the remote fallback.",
      };
    }
    return {
      id: this.id,
      kind: this.kind,
      connected: true,
      label: `Remote model (${this.cfg.model})`,
      detail: `Configured at ${this.cfg.baseUrl}. Used only when local is unavailable.`,
    };
  }

  private chat(messages: { role: string; content: string }[]): Promise<string> {
    if (!this.cfg) throw new Error("Remote AI not configured.");
    return chatRemote(this.cfg, messages);
  }

  private chatVision(
    messages: { role: string; content: string }[],
    imageDataUrl?: string
  ): Promise<string> {
    if (!this.cfg) throw new Error("Remote AI not configured.");
    if (!imageDataUrl) return chatRemote(this.cfg, messages);
    // OpenAI-compatible vision content parts (real image analysis when the
    // configured model supports vision; otherwise the provider errors honestly).
    const vision = messages.map((m, i) =>
      i === messages.length - 1 && m.role === "user"
        ? {
            role: m.role,
            content: [
              { type: "text", text: m.content },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          }
        : m
    );
    return chatRemote(this.cfg, vision as { role: string; content: string }[]);
  }

  async explainChange(change: ApiChange, ctx: SentinelContext): Promise<string> {
    return this.chat(
      ctxPrompt(`Explain this API change: ${change.type} ${change.method} ${change.path}. What changed, why it matters, affected consumers, next step. Context facts only.`, ctx)
    );
  }

  async answerQuestion(
    question: string,
    ctx: SentinelContext,
    imageDataUrl?: string
  ): Promise<Omit<AgentAnswer, "provider" | "providerKind" | "latencyMs">> {
    const answer = await this.chatVision(
      ctxPrompt(`Answer using ONLY the analysis context. Cite METHOD /path and file:line.`, ctx, `USER QUESTION:\n${wrapUntrusted("QUESTION", question.slice(0, 2000))}`),
      imageDataUrl
    );
    return {
      answer,
      grounded: true,
      evidence: ctx.changes.slice(0, 5).map((c) => ({ label: "ENDPOINT", ref: `${c.method} ${c.path}` })),
      actions: [{ id: "impact", label: "Show impact" }],
    };
  }

  async generateMigration(change: ApiChange, ctx: SentinelContext): Promise<string> {
    return this.chat(
      ctxPrompt(`Write client-migration steps for ${change.type} ${change.method} ${change.path} with before/after snippets from context facts only.`, ctx)
    );
  }

  async summarize(text: string, ctx: SentinelContext): Promise<string> {
    return this.chat(ctxPrompt(`Summarize in 3 sentences:`, ctx, wrapUntrusted("TEXT", text.slice(0, 4000))));
  }

  async generateDescription(change: ApiChange, ctx: SentinelContext): Promise<string> {
    return this.chat(
      ctxPrompt(`One-paragraph OpenAPI description for ${change.method} ${change.path}. No invented fields.`, ctx)
    );
  }
}

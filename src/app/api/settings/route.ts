import type { AppSettings } from "@/lib/sentinel/types";
import { store } from "@/db/store";
import { clampString } from "@/lib/sentinel/security/guards";
import { getSessionUser, loginRequiredPayload } from "@/lib/sentinel/auth";
import { fail, ok, readJson } from "../_util";

export const dynamic = "force-dynamic";

function current(): AppSettings {
  return {
    githubTokenSet: !!(store.getSetting("githubToken") || process.env.GITHUB_TOKEN || process.env.GH_TOKEN),
    defaultBranch: store.getSetting("defaultBranch") || "main",
    webhookSecretSet: !!(store.getSetting("webhookSecret") || process.env.GITHUB_WEBHOOK_SECRET),
    aiProviderPreference: (store.getSetting("aiProviderPreference") as AppSettings["aiProviderPreference"]) || "auto",
    localAiUrl: store.getSetting("localAiUrl") || process.env.SENTINEL_LOCAL_AI_URL || "http://localhost:11434",
    localAiModel: store.getSetting("localAiModel") || process.env.SENTINEL_LOCAL_AI_MODEL || "llama3.1",
    remoteAiUrl: store.getSetting("remoteAiUrl") || process.env.SENTINEL_REMOTE_AI_URL || "",
    remoteAiModel: store.getSetting("remoteAiModel") || process.env.SENTINEL_REMOTE_AI_MODEL || "gpt-4o-mini",
    remoteAiKeySet: !!(store.getSetting("remoteAiKey") || process.env.SENTINEL_REMOTE_AI_KEY),
    autoSyncPolicy: (store.getSetting("autoSyncPolicy") as AppSettings["autoSyncPolicy"]) || "manual",
    notificationsEnabled: (store.getSetting("notificationsEnabled") ?? "true") === "true",
    demoMode: (store.getSetting("demoMode") ?? "true") === "true",
    openapiStrictness: (store.getSetting("openapiStrictness") as AppSettings["openapiStrictness"]) || "standard",
  };
}

export async function GET() {
  // Secret values are NEVER returned — only set/not-set flags.
  return ok({ settings: current() });
}

export async function POST(req: Request) {
  if (!getSessionUser(req)) return fail("Login required to change settings.", 401, loginRequiredPayload());
  let body: Record<string, unknown>;
  try {
    body = (await readJson(req)) as Record<string, unknown>;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Bad request.", 400);
  }
  // Secrets: stored server-side only. Empty string clears the stored value.
  if (typeof body.githubToken === "string") {
    store.setSetting("githubToken", clampString(body.githubToken, 500));
  }
  if (typeof body.webhookSecret === "string") {
    store.setSetting("webhookSecret", clampString(body.webhookSecret, 500));
  }
  if (typeof body.remoteAiKey === "string") {
    const v = clampString(body.remoteAiKey, 500);
    store.setSetting("remoteAiKey", v);
    if (v) process.env.SENTINEL_REMOTE_AI_KEY = v;
  }
  if (typeof body.localAiUrl === "string" && body.localAiUrl.trim()) {
    try {
      const u = new URL(clampString(body.localAiUrl.trim(), 300));
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad scheme");
      store.setSetting("localAiUrl", u.toString().replace(/\/$/, ""));
    } catch {
      return fail("localAiUrl must be a valid http(s) URL.", 400);
    }
  }
  if (typeof body.localAiModel === "string" && body.localAiModel.trim()) {
    store.setSetting("localAiModel", clampString(body.localAiModel.trim(), 200));
  }
  if (typeof body.remoteAiUrl === "string") {
    const v = clampString(body.remoteAiUrl.trim(), 300);
    if (v) {
      try {
        const u = new URL(v);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad scheme");
        store.setSetting("remoteAiUrl", u.toString().replace(/\/$/, ""));
        process.env.SENTINEL_REMOTE_AI_URL = u.toString().replace(/\/$/, "");
      } catch {
        return fail("remoteAiUrl must be a valid http(s) URL.", 400);
      }
    } else {
      store.setSetting("remoteAiUrl", "");
    }
  }
  if (typeof body.remoteAiModel === "string" && body.remoteAiModel.trim()) {
    const v = clampString(body.remoteAiModel.trim(), 200);
    store.setSetting("remoteAiModel", v);
    process.env.SENTINEL_REMOTE_AI_MODEL = v;
  }
  if (body.aiProviderPreference === "auto" || body.aiProviderPreference === "local" || body.aiProviderPreference === "remote" || body.aiProviderPreference === "deterministic") {
    store.setSetting("aiProviderPreference", body.aiProviderPreference);
  }
  if (typeof body.defaultBranch === "string" && body.defaultBranch.trim()) {
    store.setSetting("defaultBranch", clampString(body.defaultBranch.trim(), 200));
  }
  if (body.autoSyncPolicy === "manual" || body.autoSyncPolicy === "auto-safe" || body.autoSyncPolicy === "auto-all") {
    store.setSetting("autoSyncPolicy", body.autoSyncPolicy);
  }
  if (typeof body.notificationsEnabled === "boolean") {
    store.setSetting("notificationsEnabled", String(body.notificationsEnabled));
  }
  if (body.openapiStrictness === "strict" || body.openapiStrictness === "standard") {
    store.setSetting("openapiStrictness", body.openapiStrictness);
  }
  return ok({ settings: current() });
}

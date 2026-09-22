/** Secret redaction for logs and API responses. */

const SECRET_KEYS = [
  "token",
  "secret",
  "password",
  "passwd",
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "set-cookie",
  "private",
  "credential",
  "webhook",
];

const SECRET_VALUE_PATTERNS = [
  /(gh[pousr]_[A-Za-z0-9_]+)/g,
  /(github_pat_[A-Za-z0-9_]+)/g,
  /(sk-[A-Za-z0-9_-]{8,})/g,
  /(xox[baprs]-[A-Za-z0-9-]+)/g,
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----)/g,
];

export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  // "webhookEnabled"/"webhookEvents" are not secrets; only *secret/id-like keys.
  if (k === "webhookenabled" || k === "webhookevents" || k === "webhookevent") return false;
  return SECRET_KEYS.some((s) => k.includes(s));
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 3)}••••${value.slice(-2)}`;
}

export function redactSecrets<T>(input: T): T {
  if (typeof input === "string") {
    let out: string = input;
    for (const re of SECRET_VALUE_PATTERNS) {
      re.lastIndex = 0;
      out = out.replace(re, "[REDACTED]");
    }
    return out as T;
  }
  if (Array.isArray(input)) {
    return input.map((v) => redactSecrets(v)) as unknown as T;
  }
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = isSecretKey(k)
        ? typeof v === "string" && v
          ? maskSecret(v)
          : "[REDACTED]"
        : redactSecrets(v);
    }
    return out as T;
  }
  return input;
}

/** Scans file content for accidentally committed secrets (detection only). */
export function findEmbeddedSecrets(content: string): string[] {
  const hits: string[] = [];
  const patterns: [RegExp, string][] = [
    [/gh[pousr]_[A-Za-z0-9_]{8,}/, "GitHub token"],
    [/github_pat_[A-Za-z0-9_]{8,}/, "GitHub PAT"],
    [/sk-[A-Za-z0-9_-]{16,}/, "API key"],
    [/AKIA[0-9A-Z]{16}/, "AWS key"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  ];
  for (const [re, label] of patterns) {
    if (re.test(content)) hits.push(label);
  }
  return hits;
}

/**
 * Input validation/normalization for auth endpoints.
 * Conservative by design: rejects control chars, overlong input, and
 * open-redirect targets.
 */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const email = v.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

export function normalizeName(v: unknown, fallbackEmail: string): string {
  const fallback = fallbackEmail.split("@")[0] || "user";
  if (typeof v !== "string") return fallback.slice(0, 80);
  const name = v.trim().replace(/\s+/g, " ").slice(0, 80);
  // eslint-disable-next-line no-control-regex
  if (!name || /[\u0000-\u001f\u007f]/.test(name)) return fallback.slice(0, 80);
  return name;
}

/** Post-login redirect target. Only same-origin absolute paths are allowed. */
export function safeNext(v: unknown, fallback = "/dashboard"): string {
  if (typeof v !== "string") return fallback;
  const next = v.trim();
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.includes("\n") || next.includes("\r")) return fallback;
  return next.slice(0, 256);
}

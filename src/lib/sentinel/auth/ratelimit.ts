/**
 * Tiny in-memory fixed-window rate limiter for auth endpoints
 * (brute-force protection on login/signup). Per-process by design;
 * documented as such — a shared deployment would use Redis.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function sweep(now: number) {
  if (buckets.size < 1000) return;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now()
): { allowed: boolean; retryAfterSec: number } {
  sweep(now);
  const cur = buckets.get(key);
  if (!cur || cur.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (cur.count >= max) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }
  cur.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

/** Test hook: clear all buckets. */
export function resetRateLimits() {
  buckets.clear();
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 64) || "unknown";
  return "unknown";
}

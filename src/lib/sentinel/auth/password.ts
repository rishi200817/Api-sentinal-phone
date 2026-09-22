/**
 * Password hashing with scrypt (node:crypto, no dependencies).
 *
 * Stored format: `scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`.
 * Verification uses timing-safe comparison and rejects malformed input
 * without leaking which part failed.
 */
import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scryptCb) as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALTLEN = 16;
const MAX_PASSWORD_LEN = 128;

export const MIN_PASSWORD_LEN = 8;

export function passwordPolicyError(password: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LEN) {
    return `Password must be at least ${MIN_PASSWORD_LEN} characters.`;
  }
  if (password.length > MAX_PASSWORD_LEN) {
    return `Password must be at most ${MAX_PASSWORD_LEN} characters.`;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const policy = passwordPolicyError(password);
  if (policy) throw new Error(policy);
  const salt = randomBytes(SALTLEN);
  const hash = (await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P })) as Buffer;
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function parseStored(stored: string): { salt: Buffer; hash: Buffer; N: number; r: number; p: number } | null {
  if (typeof stored !== "string") return null;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  // Refuse absurd parameters (cost-cap against DoS via crafted hashes).
  if (n < 1024 || n > 1048576 || r < 1 || r > 16 || p < 1 || p > 4) return null;
  try {
    const salt = Buffer.from(parts[4], "hex");
    const hash = Buffer.from(parts[5], "hex");
    if (salt.length < 8 || salt.length > 64 || hash.length < 16 || hash.length > 128) return null;
    return { salt, hash, N: n, r, p };
  } catch {
    return null;
  }
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_LEN) {
    return false;
  }
  const parsed = parseStored(stored);
  if (!parsed) return false;
  let derived: Buffer;
  try {
    derived = (await scryptAsync(password, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
    })) as Buffer;
  } catch {
    return false;
  }
  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}

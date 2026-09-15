import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { env } from "./env";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing for the single account.
 *
 * scrypt from Node's own crypto - no dependency, and deliberately slow, so a
 * stolen .env is not a stolen archive. The stored form carries its own
 * parameters, so raising the cost later does not invalidate existing hashes.
 *
 *   scrypt:N:r:p:saltHex:keyHex
 *
 * Colons, not the conventional "$", because this value lives in .env.local
 * and Next.js expands `$NAME` references when it reads that file: a hash
 * written as scrypt$16384$8$1$... arrives as "scrypt" and every password is
 * then wrong, with nothing in any log to say why.
 */

const N = 16384; // ~50-100ms per attempt on a normal machine
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt:${N}:${R}:${P}:${salt.toString("hex")}:${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.trim().split(":");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, n, r, p, saltHex, keyHex] = parts;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(keyHex, "hex");
    const actual = scryptSync(password.normalize("NFKC"), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Async verification, for the request path.
 *
 * scryptSync would block the event loop for ~60ms per attempt, so a burst of
 * sign-in requests would stall every other request in the process - including
 * the author's own reading and capture.
 */
async function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.trim().split(":");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, n, r, p, saltHex, keyHex] = parts;
    const expected = Buffer.from(keyHex, "hex");
    const actual = await scryptAsync(password.normalize("NFKC"), Buffer.from(saltHex, "hex"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * The configured password, in order of preference:
 *   AUTH_PASSWORD_HASH - what `npm run set-password` writes
 *   AUTH_PASSWORD      - plain text, for hosts where running a script is
 *                        awkward. It does sit in readable configuration, so
 *                        the hash is better.
 */
export async function checkPassword(password: string): Promise<boolean> {
  if (!password) return false;
  const hash = env.authPasswordHash;
  if (hash) return verifyPasswordAsync(password, hash);
  const plain = env.authPassword;
  if (plain) {
    // Reading AUTH_PASSWORD from the environment trims it, so a password
    // configured with surrounding whitespace could never be typed in. Compare
    // trimmed on both sides rather than leaving that trap in place.
    const a = Buffer.from(password.normalize("NFKC").trim());
    const b = Buffer.from(plain.normalize("NFKC").trim());
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return false;
}

export function passwordConfigured(): boolean {
  return !!env.authPasswordHash || !!env.authPassword;
}

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

export const SETTINGS_ID = "auth";

/**
 * The password hash kept in the database.
 *
 * This is the primary place, because it is the one piece of configuration
 * that is already shared between the author's machine and wherever the app
 * is deployed. Setting it once works everywhere, with no environment
 * variables to propagate and no redeploy.
 *
 * It lives in `settings`, never in `archive`, so it cannot travel inside an
 * exported copy of the archive.
 */
export async function readStoredHash(): Promise<string> {
  try {
    const { getStore } = await import("./store");
    const store = await getStore();
    const doc = await store.settings.findOne({ _id: SETTINGS_ID });
    return (doc?.passwordHash ?? "").trim();
  } catch {
    // An unreachable database must not make the environment fallback
    // unreachable too.
    return "";
  }
}

export async function writeStoredHash(hash: string): Promise<void> {
  const { getStore } = await import("./store");
  const store = await getStore();
  const existing = await store.settings.findOne({ _id: SETTINGS_ID });
  if (existing) {
    await store.settings.update({ _id: SETTINGS_ID }, { $set: { passwordHash: hash, updatedAt: new Date() } });
  } else {
    await store.settings.insert({ _id: SETTINGS_ID, passwordHash: hash, updatedAt: new Date() });
  }
  await store.flush();
}

/**
 * Where the password comes from, in order:
 *   the database       - set once, works everywhere, survives redeploys
 *   AUTH_PASSWORD_HASH - environment, for hosts with no database
 *   AUTH_PASSWORD      - plain text, last resort
 */
export async function checkPassword(password: string): Promise<boolean> {
  if (!password) return false;
  const stored = await readStoredHash();
  if (stored) return verifyPasswordAsync(password, stored);
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

export async function passwordConfigured(): Promise<boolean> {
  if (env.authPasswordHash || env.authPassword) return true;
  return !!(await readStoredHash());
}

/** For diagnostics: which of the three sources is actually in use. */
export async function passwordSource(): Promise<"database" | "AUTH_PASSWORD_HASH" | "AUTH_PASSWORD" | "nothing"> {
  if (await readStoredHash()) return "database";
  if (env.authPasswordHash) return "AUTH_PASSWORD_HASH";
  if (env.authPassword) return "AUTH_PASSWORD";
  return "nothing";
}

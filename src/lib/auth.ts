import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * Single-user auth by magic link. There is one account: the author.
 *
 * There are no roles, no teams, no invitations and no sharing permissions -
 * inheritance happens by handing someone a file, not by granting them access
 * to a service that has to still exist.
 */

export const SESSION_COOKIE = "constellation_session";
const SESSION_TTL_S = 60 * 60 * 24 * 90;
const LINK_TTL_S = 60 * 15;

interface TokenPayload {
  sub: "author";
  purpose: "session" | "magic";
  exp: number;
  jti?: string;
}

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf as any).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (s: string): Buffer => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function sign(payload: string): string {
  return b64url(createHmac("sha256", env.authSecret).update(payload).digest());
}

export function createToken(purpose: TokenPayload["purpose"], ttlSeconds: number): string {
  const payload: TokenPayload = {
    sub: "author",
    purpose,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    jti: randomUUID(),
  };
  const encoded = b64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifyToken(token: string | undefined, purpose: TokenPayload["purpose"]): TokenPayload | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(encoded).toString("utf8")) as TokenPayload;
    if (payload.sub !== "author" || payload.purpose !== purpose) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionToken(): string {
  return createToken("session", SESSION_TTL_S);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_S,
  secure: env.appOrigin.startsWith("https://"),
};

/** Server-component / route-handler check. */
export async function isAuthenticated(): Promise<boolean> {
  const jar = await cookies();
  return verifyToken(jar.get(SESSION_COOKIE)?.value, "session") !== null;
}

// --- magic links -----------------------------------------------------------

const attempts = new Map<string, number[]>();

function throttled(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  attempts.set(key, hits);
  return hits.length > max;
}

export interface MagicLinkResult {
  delivered: "console" | "webhook";
  /** Only returned in development, so the author can click through locally. */
  url?: string;
}

export async function requestMagicLink(email?: string): Promise<MagicLinkResult> {
  if (throttled("magic", 5, 60 * 60 * 1000)) {
    throw new Error("Too many sign-in requests. Try again later.");
  }
  if (env.authorEmail && email && email.trim().toLowerCase() !== env.authorEmail.toLowerCase()) {
    // Say nothing useful to a stranger, but do not send anything either.
    return { delivered: env.magicLinkDelivery };
  }

  const token = createToken("magic", LINK_TTL_S);
  const url = `${env.appOrigin}/api/auth/verify?token=${encodeURIComponent(token)}`;

  if (env.magicLinkDelivery === "webhook" && env.magicLinkWebhook) {
    try {
      await fetch(env.magicLinkWebhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, expiresInSeconds: LINK_TTL_S }),
        signal: AbortSignal.timeout(10_000),
      });
      return { delivered: "webhook" };
    } catch (err) {
      console.warn(`[auth] webhook delivery failed (${(err as Error).message}); falling back to console.`);
    }
  }

  console.log(`\n[auth] Sign-in link (valid ${LINK_TTL_S / 60} minutes):\n${url}\n`);
  try {
    const dir = env.dataDir;
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, "magic-link.txt"), `${new Date().toISOString()}\n${url}\n`, "utf8");
  } catch {
    /* the console line is enough */
  }
  return {
    delivered: "console",
    url: process.env.NODE_ENV === "production" ? undefined : url,
  };
}

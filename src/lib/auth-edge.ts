/**
 * Session verification for the edge middleware. Same token format as
 * src/lib/auth.ts, verified with Web Crypto because Node's crypto is not
 * available in the middleware runtime.
 */

export const SESSION_COOKIE = "constellation_session";

function fromB64url(s: string): ArrayBuffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return buffer;
}

export async function verifySessionToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      fromB64url(signature),
      new TextEncoder().encode(encoded),
    );
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(encoded))) as {
      sub?: string;
      purpose?: string;
      exp?: number;
    };
    return payload.sub === "author" && payload.purpose === "session" && (payload.exp ?? 0) * 1000 > Date.now();
  } catch {
    return false;
  }
}

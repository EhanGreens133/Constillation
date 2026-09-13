import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { HttpError } from "./entries";
import { SESSION_COOKIE, verifyToken } from "./auth";

/**
 * The real authorisation check, and the only one that matters.
 *
 * It runs in the Node runtime, so AUTH_SECRET is read at request time rather
 * than baked into a bundle at build time. Every API route calls this first;
 * the middleware only decides where to send a browser that has no session at
 * all.
 */
export async function requireAuthor(): Promise<void> {
  const jar = await cookies();
  if (!verifyToken(jar.get(SESSION_COOKIE)?.value, "session")) {
    throw new HttpError(401, "not signed in");
  }
}

export function json(data: unknown, init?: number | ResponseInit): NextResponse {
  return NextResponse.json(data as any, typeof init === "number" ? { status: init } : init);
}

export function fail(err: unknown): NextResponse {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  const message = err instanceof Error ? err.message : "unknown error";
  console.error("[api]", err);
  return json({ error: message }, 500);
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "expected a JSON body");
  }
}

export const boolParam = (v: string | null): boolean | undefined =>
  v === null ? undefined : v === "1" || v === "true";

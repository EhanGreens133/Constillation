import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions, verifyToken } from "@/lib/auth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? undefined;
  const next = url.searchParams.get("next") || "/";

  if (!verifyToken(token, "magic")) {
    return NextResponse.redirect(new URL("/login?error=expired", env.appOrigin));
  }
  const res = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", env.appOrigin));
  res.cookies.set(SESSION_COOKIE, createSessionToken(), sessionCookieOptions);
  return res;
}

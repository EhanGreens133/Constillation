import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.redirect(new URL("/login", env.appOrigin));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

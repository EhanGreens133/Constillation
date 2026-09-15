import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/auth-edge";

/**
 * Routing, not authorisation.
 *
 * This runs in the edge runtime, where Next inlines `process.env` at build
 * time. A secret baked into the bundle is the wrong place to hold the only
 * gate: change AUTH_SECRET without rebuilding and the middleware would start
 * rejecting valid sessions, which is exactly the sort of failure that locks
 * an author out of his own archive.
 *
 * So the real check lives in the Node runtime, in requireAuthor(), which
 * every API route calls and which reads the secret at request time. All this
 * does is send a browser with no session to the sign-in page instead of
 * rendering a shell that cannot load anything.
 */

// The sign-in endpoints must be reachable without a session, or there is no
// way to ever get one.
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/request",
  "/api/auth/verify",
  "/api/health",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (req.cookies.get(SESSION_COOKIE)?.value) {
    // Present, not verified. requireAuthor() decides.
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icon.svg).*)"],
};

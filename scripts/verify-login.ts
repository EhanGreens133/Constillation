/**
 * Checks password sign-in against a running server.
 *
 *   npm run verify:login
 *
 * It uses its own password via AUTH_PASSWORD_HASH, so it never needs to know
 * yours and never touches .env.local. Start the server with the same hash:
 * the script prints the exact command if you run it with --print-hash.
 */

import { loadEnv } from "./lib/load-env";
loadEnv();

import { check, eq, info, section, summary } from "./lib/harness";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { safeNext } from "../src/lib/auth";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const password = process.env.TEST_PASSWORD ?? "correct-horse-battery-staple";

if (process.argv.includes("--print-hash")) {
  console.log(`AUTH_PASSWORD_HASH=${hashPassword(password)}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
section("Hashing");

const hash = hashPassword(password);
check("a hash carries its own parameters", /^scrypt:16384:8:1:[0-9a-f]{32}:[0-9a-f]{64}$/.test(hash));
// The hash is stored in .env.local, which Next.js runs through dotenv-expand.
// A "$" in the value would be read as a variable reference and silently
// disappear, making every correct password wrong.
check("the hash survives .env expansion (no $ in it)", !hash.includes("$"));
check("the hash needs no quoting in .env (no spaces or newlines)", !/[\s"']/.test(hash));
check("the right password verifies", verifyPassword(password, hash));
check("the wrong password does not", !verifyPassword(`${password}x`, hash));
check("an empty password does not", !verifyPassword("", hash));
check("a corrupted hash fails closed", !verifyPassword(password, "scrypt$16384$8$1$aa$bb"));
check("a garbage hash fails closed", !verifyPassword(password, "not-a-hash"));
check("the password is nowhere in the hash", !hash.includes(password));
const second = hashPassword(password);
check("the same password hashes differently each time (random salt)", hash !== second);
check("but both verify", verifyPassword(password, second));

const t0 = Date.now();
verifyPassword(password, hash);
const ms = Date.now() - t0;
info(`one verification takes ${ms}ms - deliberately slow, to make guessing expensive`);
check("verification is slow enough to matter", ms >= 10);

// ---------------------------------------------------------------------------
section("Where sign-in is allowed to send you afterwards");

// "starts with a slash" is not enough: these all resolve to another origin.
for (const hostile of ["//evil.com", "//evil.com/path", "/\\evil.com", "https://evil.com", "http://evil.com"]) {
  eq(`${hostile} is refused`, safeNext(hostile), "/");
}
eq("a normal path is kept", safeNext("/entries"), "/entries");
eq("a path with a query is kept", safeNext("/entries?cluster=abc"), "/entries?cluster=abc");
eq("nothing falls back to the home page", safeNext(null), "/");
eq("an empty string falls back", safeNext(""), "/");

// ---------------------------------------------------------------------------
section(`Signing in at ${base}`);

let reachable = true;
try {
  await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(4000) });
} catch {
  reachable = false;
}
if (!reachable) {
  info("no server is running, so the HTTP checks were skipped");
  info(`start one with:  AUTH_PASSWORD_HASH=<hash> npm start   (get the hash with --print-hash)`);
  summary();
}

const login = async (pw: string) =>
  fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: pw }),
    redirect: "manual",
  });

const wrong = await login("definitely-not-the-password");
if (wrong.status === 409) {
  info("this server has no password configured, so the HTTP checks were skipped");
  info("start it with AUTH_PASSWORD_HASH set to the hash printed by --print-hash");
  summary();
}
eq("a wrong password is refused", wrong.status, 401);

// The server may be running with the author's real password rather than the
// test one. Refusing this script's password is then correct behaviour, not a
// failure - so check that it refuses, and leave the rest alone.
const probe = await login(password);
if (probe.status === 401) {
  const body = (await probe.json()) as { error?: string };
  check("and says so without hinting at the real one", /wrong password/i.test(body.error ?? ""));
  info("this server is configured with a different password (yours), so it correctly refused the test one");
  info("to exercise the full flow: AUTH_PASSWORD_HASH=$(npm run -s verify:login -- --print-hash) npm start");
  summary();
}
const wrongBody = (await wrong.json()) as { error?: string };
check("and says so without hinting at the real one", /wrong password/i.test(wrongBody.error ?? ""));
check("no cookie is set on failure", !(wrong.headers.get("set-cookie") ?? "").includes("constellation_session"));

const right = probe;
eq("the right password is accepted", right.status, 200);
const cookie = right.headers.get("set-cookie") ?? "";
check("a session cookie is set", cookie.includes("constellation_session="));
check("the cookie is HttpOnly", /httponly/i.test(cookie));
check("the cookie is SameSite=Lax", /samesite=lax/i.test(cookie));

const session = cookie.split(";")[0];
const api = await fetch(`${base}/api/entries?limit=1`, { headers: { cookie: session } });
eq("the session works against the API", api.status, 200);

const page = await fetch(base, { headers: { cookie: session }, redirect: "manual" });
check("and gets past the redirect to /login", page.status === 200, `status ${page.status}`);

const noSession = await fetch(`${base}/api/entries?limit=1`, { redirect: "manual" });
eq("while no session is still refused", noSession.status, 401);

section("Guessing in parallel does not beat the limit");

// The bug this covers: checking the counter, then awaiting, then recording a
// failure lets any number of concurrent requests through a gate that still
// reads zero. Fire a burst at once and count how many were actually let in.
const burst = await Promise.all(
  Array.from({ length: 25 }, () => login(`wrong-${Math.random()}`).then((r) => r.status)),
);
const allowed = burst.filter((s) => s === 401).length;
const throttled = burst.filter((s) => s === 429).length;
info(`25 simultaneous wrong guesses: ${allowed} checked, ${throttled} throttled`);
check("the burst is capped near the limit, not waved through", allowed <= 12, `${allowed} got through`);
check("the rest are refused with 429", throttled >= 13);

const afterBurst = await login(password);
eq("and the throttle now applies to the right password too", afterBurst.status, 429);
const retryAfter = afterBurst.headers.get("retry-after");
check("with a retry-after header", !!retryAfter && Number(retryAfter) > 0, String(retryAfter));
const body429 = (await afterBurst.json()) as { error?: string };
check("and a way back in that is not the password", /npm run login/.test(body429.error ?? ""), body429.error);

summary();

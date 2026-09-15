/**
 * Mints a sign-in link and prints it.
 *
 *   npm run login            print a link
 *   npm run login -- --open  print it and open the browser
 *
 * This exists because the author of a self-hosted single-user archive already
 * has the terminal in front of them. Making them dig a URL out of a log file
 * was a worse experience than the thing it was protecting.
 *
 * It is signed with the AUTH_SECRET in .env.local, so it only works against a
 * server started with that same secret - if you rotated it, restart the
 * server first. The link is valid for 15 minutes and the server sets the
 * session cookie when you follow it.
 */

import { loadEnv } from "./lib/load-env";
loadEnv();

import { spawn } from "node:child_process";
import { createToken } from "../src/lib/auth";
import { env } from "../src/lib/env";

const origin = env.appOrigin;
const url = `${origin}/api/auth/verify?token=${encodeURIComponent(createToken("magic", 60 * 15))}`;

// Is the server actually up? A dead link is confusing in a different way.
let reachable = false;
try {
  const res = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(4000) });
  reachable = res.ok;
} catch {
  reachable = false;
}

console.log("");
if (!reachable) {
  console.log(`  No server answered at ${origin}.`);
  console.log("  Start one first:  npm run dev     (or: npm run build && npm start)");
  console.log("");
  console.log("  The link below is still valid for 15 minutes once it is up:");
  console.log("");
}
console.log(`  ${url}`);
console.log("");
console.log("  Valid for 15 minutes. Open it in your browser and you are signed in.");
if (env.authSecret === "dev-insecure-secret-do-not-use-in-production") {
  console.log("  (AUTH_SECRET is unset, so this is using the development default.)");
}
console.log("");

if (process.argv.includes("--open") && reachable) {
  const opener =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] :
    process.platform === "darwin" ? ["open", [url]] :
    ["xdg-open", [url]];
  spawn(opener[0] as string, opener[1] as string[], { detached: true, stdio: "ignore" }).unref();
  console.log("  Opening your browser…\n");
}

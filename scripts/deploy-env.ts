/**
 * Prints the environment variables a deployed instance needs.
 *
 *   npm run env:deploy              the block to paste into your host
 *   npm run env:deploy -- --url https://your-app.example.com
 *
 * .env.local is git-ignored, so nothing in it reaches the deployed app. This
 * reads it and prints what to set on the host instead, with the checks that
 * catch the usual deployment failures: a localhost APP_ORIGIN, a missing
 * AUTH_SECRET, a password that was fine on a laptop and is not fine on the
 * open internet.
 *
 * Values are printed to your terminal only. Treat the output as a secret.
 */

import { loadEnv } from "./lib/load-env";
loadEnv();

const urlFlag = process.argv.indexOf("--url");
const publicUrl = urlFlag !== -1 ? (process.argv[urlFlag + 1] ?? "").replace(/\/$/, "") : "";

const REQUIRED = ["AUTH_SECRET", "MONGODB_URI", "MONGODB_DB", "APP_ORIGIN"] as const;
const AUTH = ["AUTH_PASSWORD_HASH", "AUTH_PASSWORD"] as const;
const OPTIONAL = [
  "OPENAI_API_KEY",
  "SUGGEST_MODEL",
  "EMBEDDING_PROVIDER",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIMENSIONS",
  "ATLAS_SEARCH_INDEX",
  "ATLAS_VECTOR_INDEX",
  "AUTHOR_EMAIL",
  "MAGIC_LINK_DELIVERY",
] as const;

const val = (k: string): string => (process.env[k] ?? "").trim();
const problems: string[] = [];
const notes: string[] = [];

console.log("\n=== Set these on your host =========================================\n");

for (const key of REQUIRED) {
  let value = val(key);
  if (key === "APP_ORIGIN") {
    if (publicUrl) value = publicUrl;
    else if (!value || /localhost|127\.0\.0\.1/.test(value)) {
      problems.push(
        "APP_ORIGIN is a localhost address. On the host it must be the public URL, or sign-in links point at localhost and the session cookie is not marked Secure. Re-run with --url https://your-app",
      );
      value = value || "http://localhost:3000";
    }
  }
  if (!value) {
    problems.push(`${key} is not set locally either - it is required.`);
    continue;
  }
  console.log(`${key}=${value}`);
}

const hash = val("AUTH_PASSWORD_HASH");
const plain = val("AUTH_PASSWORD");
if (hash) {
  console.log(`AUTH_PASSWORD_HASH=${hash}`);
} else if (plain) {
  console.log(`AUTH_PASSWORD=${plain}`);
  notes.push("AUTH_PASSWORD is plain text. `npm run set-password` stores a hash instead, which is better at rest.");
} else {
  problems.push("No password is set. Run `npm run set-password` first, then run this again.");
}

for (const key of OPTIONAL) {
  const value = val(key);
  if (value) console.log(`${key}=${value}`);
}

console.log("\n====================================================================\n");

// --- the checks that catch real deployment failures ------------------------
const origin = publicUrl || val("APP_ORIGIN");
if (origin.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(origin)) {
  problems.push(`${origin} is plain http. The session cookie will not be marked Secure. Use https.`);
}
if (val("AUTH_SECRET") === "change-me-to-32-plus-random-bytes") {
  problems.push("AUTH_SECRET is still the placeholder.");
}
if (val("MONGODB_URI")) {
  notes.push(
    "Atlas blocks unknown IPs. Add your host's outbound addresses under Network Access, or 0.0.0.0/0 if the host has no fixed IPs - a wrong setting here looks like the app hanging on every page.",
  );
}
if (origin && !/localhost|127\.0\.0\.1/.test(origin)) {
  notes.push(
    "Reachable from the internet: one password is now the only thing in front of the whole archive. Use a long one - `npm run set-password` and paste the new hash here.",
  );
}
notes.push("Changing any of these needs a restart or redeploy before the app sees them.");

if (problems.length) {
  console.log("Fix first:\n");
  for (const p of problems) console.log(`  - ${p}`);
  console.log("");
}
console.log("Worth knowing:\n");
for (const n of notes) console.log(`  - ${n}`);
console.log("");
process.exit(problems.length ? 1 : 0);

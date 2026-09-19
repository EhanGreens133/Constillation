/**
 * Sets the sign-in password.
 *
 *   npm run set-password                 asks for it, hidden as you type
 *   npm run set-password -- "my pass"    non-interactive
 *   npm run set-password -- "pw" --force accept one shorter than the minimum
 *
 * The password is hashed with scrypt and only the hash is written, into
 * .env.local (which is git-ignored). The password itself is never stored and
 * never printed.
 */

import { loadEnv } from "./lib/load-env";
loadEnv();

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { hashPassword } from "../src/lib/password";

const MIN = 8;

async function askHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'no terminal to ask on - pass it instead:  npm run set-password -- "your password"',
    );
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const asStream = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: (s: string) => void };
  asStream._writeToOutput = function (s: string) {
    // Echo the prompt, mask everything typed after it.
    asStream.output.write(s.includes(prompt) ? prompt : "*");
  };
  const answer = await new Promise<string>((resolve) => rl.question(prompt, resolve));
  rl.close();
  process.stdout.write("\n");
  return answer;
}

const fromArgs = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ").trim();
let password = fromArgs;

if (!password) {
  password = (await askHidden("New password: ")).trim();
  const again = (await askHidden("Again to confirm: ")).trim();
  if (password !== again) {
    console.error("\nThose did not match. Nothing was changed.\n");
    process.exit(1);
  }
}

const forced = process.argv.includes("--force");
if (password.length < MIN && !forced) {
  console.error(
    `\nThat is ${password.length} characters. Use at least ${MIN} - this one password stands between a stranger and everything you have written.`,
  );
  console.error(`If you mean it, repeat the command with --force.\n`);
  process.exit(1);
}
if (password.length < MIN) {
  // Their archive, their call - but it should not be a silent one.
  console.warn(
    `\nAccepting a ${password.length}-character password because --force was given.\n` +
      `Sign-in attempts are limited to 10 per 10 minutes, which is what makes a short\n` +
      `password survivable. Lengthen it before APP_ORIGIN points anywhere public.`,
  );
}

const hash = hashPassword(password);

/**
 * Default target is the database, because that is the one thing a laptop and
 * a deployed app already share. Setting it there works in both places at
 * once - no environment variables to copy, no redeploy, nothing to get out of
 * step. `--local` writes to .env.local instead, for running without a
 * database at all.
 */
const toLocalFile = process.argv.includes("--local") || !process.env.MONGODB_URI;

if (!toLocalFile) {
  const { writeStoredHash } = await import("../src/lib/password");
  const { resetStore } = await import("../src/lib/store");
  await writeStoredHash(hash);
  await resetStore();
  console.log("\nPassword set, in the database.");
  console.log(`Stored in the "settings" collection as a scrypt hash; the password itself is not stored,`);
  console.log("and nothing in that collection is ever part of an export.");
  console.log("\nIt applies everywhere that database is used - this machine and your deployed app -");
  console.log("immediately. No redeploy, no environment variables.\n");
} else {
  const file = path.join(process.cwd(), ".env.local");
  const line = `AUTH_PASSWORD_HASH=${hash}`;
  let contents = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (/^AUTH_PASSWORD_HASH=.*$/m.test(contents)) {
    contents = contents.replace(/^AUTH_PASSWORD_HASH=.*$/m, line);
    console.log("\nPassword changed.");
  } else {
    const eol = contents.includes("\r\n") ? "\r\n" : "\n";
    if (contents && !contents.endsWith("\n")) contents += eol;
    contents += `${eol}# Set by \`npm run set-password\`. The password itself is not stored.${eol}${line}${eol}`;
    console.log("\nPassword set.");
  }
  fs.writeFileSync(file, contents, "utf8");
  console.log(`Written to ${path.relative(process.cwd(), file)} as a scrypt hash.`);
  console.log("\nRestart the server so it picks this up, then sign in at /login:\n");
  console.log("  npm run build && npm start      (or: npm run dev)\n");
}

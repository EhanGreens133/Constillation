import fs from "node:fs";
import path from "node:path";

/**
 * Loads .env.local then .env into process.env, for the scripts that talk to
 * real services.
 *
 * Next.js does this itself for the application; plain `tsx` does not, which
 * would otherwise mean `npm run indexes` quietly creating nothing because it
 * never saw MONGODB_URI and fell back to the local JSON store.
 *
 * Only the operational scripts load this. The test suites deliberately do not:
 * they are supposed to run against a scratch directory with no services
 * configured, because that is the configuration the archive has to survive.
 *
 * Values already in the environment win, so `MONGODB_URI=... npm run seed`
 * still overrides the file.
 */

const FILES = [".env.local", ".env"];

export function loadEnv(cwd = process.cwd()): string[] {
  const loaded: string[] = [];
  for (const name of FILES) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) continue;
    let count = 0;
    for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!key || key in process.env) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
      count++;
    }
    loaded.push(`${name} (${count} values)`);
  }
  return loaded;
}

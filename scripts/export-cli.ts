/**
 * Writes an export to disk without going through the browser. Useful for a
 * cron job on the author's own box - a dated copy every month costs nothing
 * and is the cheapest insurance there is.
 *
 *   npm run export                      inheritance edition -> ./exports
 *   npm run export -- working ./backups
 */

import fs from "node:fs";
import path from "node:path";
import { buildExport, type Edition } from "../src/lib/export/build";
import { resetStore } from "../src/lib/store";

const edition: Edition = process.argv.includes("working") ? "working" : "inheritance";
const outDir = process.argv.find((a) => a.startsWith("./") || a.startsWith("/") || /^[A-Za-z]:\\/.test(a)) ?? "./exports";

const result = await buildExport(edition);
fs.mkdirSync(outDir, { recursive: true });
const zipPath = path.join(outDir, result.filename);
fs.writeFileSync(zipPath, result.zip);

console.log(`${edition} edition -> ${zipPath}`);
console.log(`  ${result.bundle.counts.entries} entries, built ${result.bundle.builtAt}`);
for (const f of result.files) console.log(`  ${f.name.padEnd(16)} ${(f.bytes / 1024).toFixed(0)}KB`);
if (result.bundle.counts.omittedPrivate) {
  console.log(`  ${result.bundle.counts.omittedPrivate} private entries left out`);
}
for (const w of result.bundle.warnings) console.log(`  ! ${w}`);

await resetStore();

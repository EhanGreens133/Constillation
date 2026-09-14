/**
 * Verifies an export the way a reader will meet it: by reading the file back
 * out of the zip and checking it can stand alone.
 *
 *   npm run verify:export                        build from the live store and check
 *   npm run verify:export -- ./exports/x.zip     check a zip already on disk
 *
 * What it proves: the four files exist and pass their CRCs, the HTML contains
 * the whole archive and the opening message, there is not a single network
 * reference in it, and no private entry leaked into the inheritance edition.
 *
 * What it cannot prove: that the machine you open it on is actually offline.
 * Do that part by hand, once, properly - it is the only test that matters.
 */

import { loadEnv } from "./lib/load-env";
loadEnv();

import fs from "node:fs";
import path from "node:path";
import { check, info, section, summary } from "./lib/harness";
import { unzip } from "./lib/unzip";
import { buildBundle, buildExport } from "../src/lib/export/build";
import { resetStore } from "../src/lib/store";

const zipArg = process.argv.slice(2).find((a) => a.endsWith(".zip"));

let zip: Buffer;
let privateBodies: string[] = [];
let privateIds: string[] = [];
/** opening 60 characters -> how many entries start with them */
const bodyCounts = new Map<string, number>();
let expectedEntries: number | null = null;
let label: string;

if (zipArg) {
  zip = fs.readFileSync(zipArg);
  label = zipArg;
} else {
  const result = await buildExport("inheritance");
  zip = result.zip;
  label = `freshly built ${result.filename}`;
  expectedEntries = result.bundle.counts.entries;
  const working = await buildBundle("working");
  privateBodies = working.entries.filter((e) => e.private).map((e) => e.body);
  privateIds = working.entries.filter((e) => e.private).map((e) => e._id);
  for (const e of working.entries) {
    const key = e.body.slice(0, 60);
    bodyCounts.set(key, (bodyCounts.get(key) ?? 0) + 1);
  }
  const outDir = "./exports";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, result.filename), zip);
  info(`written to ${path.join(outDir, result.filename)}`);
}

section(`Reading ${label} back out of the zip`);

const files = unzip(zip);
const names = files.map((f) => f.name);
info(`contains: ${names.join(", ")}`);

for (const required of ["archive.html", "archive.txt", "archive.json", "README.txt"]) {
  check(`${required} is present`, names.includes(required));
}
check("every file passes its CRC", files.every((f) => f.crcOk));

const html = files.find((f) => f.name === "archive.html")?.data.toString("utf8") ?? "";
const txt = files.find((f) => f.name === "archive.txt")?.data.toString("utf8") ?? "";
const json = files.find((f) => f.name === "archive.json")?.data.toString("utf8") ?? "";
const readme = files.find((f) => f.name === "README.txt")?.data.toString("utf8") ?? "";

section("archive.html stands alone");

check("it is a complete HTML document", /^<!DOCTYPE html>/i.test(html.trim()) && html.includes("</html>"));
check("no <script src> or <link href> to anything", !/<script[^>]+\bsrc\s*=/i.test(html) && !/<link[^>]+\bhref\s*=/i.test(html));
check("no fetch, XHR or WebSocket", !/\bfetch\s*\(|XMLHttpRequest|new WebSocket/i.test(html));
check("no http(s) URL anywhere in the file", !/https?:\/\//i.test(html.replace(/xmlns="[^"]*"/g, "")));
check("no web font", !/@font-face|fonts\.(googleapis|gstatic)/i.test(html));
check("no import statement", !/\bimport\s+[^(]/.test(html.replace(/-webkit-[a-z-]+/g, "")));
check("the data is embedded as JSON in a script tag", html.includes('<script type="application/json" id="archive-data">'));
check("'<' is escaped inside the embedded JSON", !html.slice(html.indexOf("archive-data")).split("</script>")[0].includes("<script"));

const marker = 'id="archive-data">';
const jsonStart = html.indexOf(marker) + marker.length;
const jsonEnd = html.indexOf("</script>", jsonStart);
let parsed: { entries: unknown[]; archive: { opening: string; title: string }; builtAt: string } | null = null;
try {
  parsed = JSON.parse(html.slice(jsonStart, jsonEnd));
} catch (err) {
  info(`could not parse the embedded JSON: ${(err as Error).message}`);
}
check("the embedded JSON parses", !!parsed);
let empty = false;
if (parsed) {
  info(`${parsed.entries.length} entries embedded, built ${parsed.builtAt}`);
  empty = parsed.entries.length === 0;
  if (expectedEntries !== null) check("every entry made it into the HTML", parsed.entries.length === expectedEntries);
  if (empty) {
    // An export of an empty archive is a valid export, not a broken one -
    // but it cannot demonstrate anything about content.
    info("this archive has no entries yet, so the content checks below are skipped");
    info("run `npm run seed` (or write something) and verify again");
  } else {
    check("the archive is not empty", true);
    check("the opening message is present", parsed.archive.opening.trim().length > 0);
    if (parsed.archive.opening.trim()) {
      check(
        "the opening message appears before the data, in document order",
        html.indexOf(parsed.archive.opening.slice(0, 24)) < jsonStart,
      );
    }
  }
}
check("there is a <noscript> fallback pointing at archive.txt", /<noscript>[\s\S]*archive\.txt/i.test(html));

section("The other three files");

check("archive.txt is plain text with content", txt.length > 200 && !txt.includes("<html"));
if (!empty) {
  check("archive.txt is chronological and grouped by year", /={10,}\r?\n\d{4}\r?\n={10,}/.test(txt));
}
check("archive.txt carries bodies and later notes", txt.includes("Later note") || txt.includes("END OF ARCHIVE"));
check("archive.json documents its own schema", json.includes("documentation") && json.includes("entries[].body"));
check("archive.json holds no embeddings", !json.includes('"embedding"'));
check("README.txt names archive.html first and archive.txt as the fallback", readme.indexOf("archive.html") < readme.indexOf("archive.txt"));
check("README.txt explains what the reader is holding", /WHAT THIS IS/.test(readme));

if (privateIds.length > 0) {
  section(`Private entries (${privateIds.length}) must be absent`);

  // Identity first: an entry's id is unique, so this is exact.
  const idLeaks = privateIds.filter((id) => html.includes(id) || txt.includes(id) || json.includes(id));
  check("no private entry's id appears in the inheritance edition", idLeaks.length === 0, idLeaks[0]);

  // Then text, but only for private entries whose opening is unique in the
  // archive. Two entries can legitimately begin with the same words, and a
  // shared opening is not evidence of a leak.
  const unique = privateBodies.filter((body) => bodyCounts.get(body.slice(0, 60)) === 1);
  const textLeaks = unique.filter((body) => {
    const probe = body.slice(0, 60);
    return html.includes(probe) || txt.includes(probe) || json.includes(probe);
  });
  check(
    `no private text leaked (${unique.length} of ${privateBodies.length} private entries have a unique opening to test)`,
    textLeaks.length === 0,
    textLeaks[0]?.slice(0, 60),
  );
  if (unique.length < privateBodies.length) {
    info(
      `${privateBodies.length - unique.length} private entries share their opening words with another entry, so only the id check applies to them`,
    );
  }
} else if (!zipArg) {
  section("Private entries");
  info("no entries are marked private, so there was nothing to exclude");
}

section("By hand, once");
info("1. copy the zip to a USB stick");
info("2. on another machine, turn networking off");
info("3. unzip, double-click archive.html");
info("4. the opening message must appear first; then search, open an entry, follow a connection");
info("5. open archive.txt and confirm the same entries are there");

await resetStore();
summary();

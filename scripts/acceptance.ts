/**
 * The acceptance tests from the brief, run against the real code paths with
 * no services configured at all: no database, no embedding provider, no
 * model. That is the configuration the archive has to survive, so it is the
 * configuration the tests use.
 *
 *   npm test
 *   npm test -- --scale        (also seeds 5,000 entries and measures)
 */

import fs from "node:fs";
import { check, eq, info, section, summary, useScratchStore } from "./lib/harness";
import { CHARGED, FORBIDDEN_TITLES, syntheticBody } from "./lib/fixtures";
import { unzip } from "./lib/unzip";

const dir = useScratchStore("acceptance");

const { getStore, resetStore } = await import("../src/lib/store");
const {
  captureEntry,
  patchEntry,
  addReflection,
  softDeleteEntry,
  listEntries,
  getFacets,
  connectEntries,
  HttpError,
} = await import("../src/lib/entries");
const { createCluster, deleteCluster, listClusters } = await import("../src/lib/clusters");
const { putArchive } = await import("../src/lib/archive");
const { searchEntries } = await import("../src/lib/search");
const { suggestForEntries, verbatimTitle, verbatimYear } = await import("../src/lib/suggest");
const { rethreadAll } = await import("../src/lib/related");
const { runLayout } = await import("../src/lib/layout");
const { buildExport, buildBundle, renderArchiveJson } = await import("../src/lib/export/build");
const { displayTitle } = await import("../src/lib/format");

const scale = process.argv.includes("--scale");

// ---------------------------------------------------------------------------
section("Capture requires nothing");

const captured: string[] = [];
for (let i = 0; i < 50; i++) {
  const entry = await captureEntry({ body: `Entry number ${i}. ${syntheticBody(i)}` });
  captured.push(entry._id);
}
const store = await getStore();

eq("50 entries captured with body alone", captured.length, 50);
const sample = (await store.entries.findOne({ _id: captured[0] }))!;
eq("title is empty, not a placeholder", sample.title, "");
eq("titleSource is empty when there is no title", sample.titleSource, "");
eq("clusterId is null - unfiled is a valid resting state", sample.clusterId, null);
check("whenWritten was set by the system", sample.whenWritten instanceof Date);
check("no embedding was required", sample.embedding === undefined);

const displayed = displayTitle(sample);
check("an untitled entry displays its own opening words", displayed.excerpt && sample.body.startsWith(displayed.text.slice(0, 20)));
check("the word 'Untitled' is never fabricated", displayed.text !== "Untitled");
eq("an entry with an empty body would show Untitled", displayTitle({ body: "", title: "" }).text, "Untitled");

const listed = await listEntries({ limit: 1000 });
eq("all 50 are listed", listed.total, 50);
const found = await searchEntries("allotment");
check("untitled, unfiled entries are findable by their words", found.hits.length > 0, `${found.hits.length} hits`);
info(`search engine: ${found.engine}, ${found.took}ms`);

// ---------------------------------------------------------------------------
section("The original text is immutable by the system, whenWritten is fixed");

let rejected = false;
try {
  await patchEntry(captured[0], { whenWritten: new Date().toISOString() } as never);
} catch (err) {
  rejected = err instanceof HttpError && err.status === 400;
}
check("PATCH rejects a change to whenWritten", rejected);

let bodyByMachine = false;
try {
  await patchEntry(captured[0], { body: "rewritten by a machine", source: "suggested" });
} catch (err) {
  bodyByMachine = err instanceof HttpError && err.status === 403;
}
check("a non-author source may not change the body", bodyByMachine);
const afterAttempts = (await store.entries.findOne({ _id: captured[0] }))!;
eq("the body is untouched", afterAttempts.body, sample.body);

await addReflection(captured[0], "Reading this back years later, I would put it differently.");
const reflected = (await store.entries.findOne({ _id: captured[0] }))!;
eq("a reflection was appended", reflected.reflections.length, 1);
eq("the body still has not changed", reflected.body, sample.body);
check("the three times are distinct fields", reflected.whenWritten !== undefined && reflected.whenHappened === null && reflected.reflections[0].at !== undefined);

// ---------------------------------------------------------------------------
section("Generated text is marked, and reversible without touching the source");

await patchEntry(captured[1], { title: "Entry number 1", source: "suggested" });
const suggestedTitle = (await store.entries.findOne({ _id: captured[1] }))!;
eq("a suggested title is marked as suggested", suggestedTitle.titleSource, "suggested");
const bodyBefore = suggestedTitle.body;
await patchEntry(captured[1], { title: "" });
const reverted = (await store.entries.findOne({ _id: captured[1] }))!;
eq("clearing the title reverts to the opening words", reverted.titleSource, "");
eq("reverting did not touch the body", reverted.body, bodyBefore);

// ---------------------------------------------------------------------------
section("Suggestions propose; they never write");

const beforeSuggest = await store.entries.find({ _id: { $in: captured.slice(0, 5) } });
const suggestion = await suggestForEntries(captured.slice(0, 5));
const afterSuggest = await store.entries.find({ _id: { $in: captured.slice(0, 5) } });
eq(
  "nothing changed in the database",
  JSON.stringify(afterSuggest.map((e) => [e.title, e.kind, e.clusterId, e.whenHappened])),
  JSON.stringify(beforeSuggest.map((e) => [e.title, e.kind, e.clusterId, e.whenHappened])),
);
info(`engine: ${suggestion.engine}; ${suggestion.proposals.length} proposals, ${suggestion.rejected.length} discarded`);

let allVerbatim = true;
for (const p of suggestion.proposals) {
  if (!p.title) continue;
  const entry = afterSuggest.find((e) => e._id === p.entryId)!;
  const flat = entry.body.replace(/\s+/g, " ").trim().toLowerCase();
  if (!flat.includes(p.title.toLowerCase())) allVerbatim = false;
}
check("every proposed title is a verbatim span of the entry", allVerbatim);

for (const bad of FORBIDDEN_TITLES) {
  const verdict = verbatimTitle(bad.body, bad.title);
  check(`rejected: "${bad.title}" (${bad.why})`, !("title" in verdict), "title" in verdict ? "it was accepted" : undefined);
}
check("a year not named in the text is dropped", verbatimYear("no year here at all", 1994).year === null);
check("a year named in the text is kept", verbatimYear("It was 1994, I think.", 1994).year === 1994);

// ---------------------------------------------------------------------------
section("Private by choice: editions");

for (let i = 0; i < 5; i++) {
  await patchEntry(captured[10 + i], { private: true });
}
const privatePhrase = "PRIVATE-MARKER-ferry-hospital-cortina";
await patchEntry(captured[10], { private: true });
await store.entries.update({ _id: captured[10] }, { $set: { body: `${privatePhrase} something I would not pass on.` } });

const inheritance = await buildBundle("inheritance");
const working = await buildBundle("working");
eq("inheritance leaves out all 5 private entries", inheritance.entries.length, 45);
eq("the working copy contains everything", working.entries.length, 50);
check(
  "no private entry appears in the inheritance edition",
  !inheritance.entries.some((e) => e.private),
);
check(
  "private text is absent from the inheritance JSON",
  !renderArchiveJson(inheritance).includes(privatePhrase),
);
check("private text is present in the working copy", renderArchiveJson(working).includes(privatePhrase));
check("embeddings are absent from the export", !("embedding" in (inheritance.entries[0] as object)));

// ---------------------------------------------------------------------------
section("Clusters: deleting one unfiles its entries and loses none");

const family = await createCluster({ name: "Family" });
const work = await createCluster({ name: "Work" });
for (let i = 0; i < 8; i++) await patchEntry(captured[20 + i], { clusterId: family._id });
const facetsBefore = await getFacets({ includePrivate: true });
eq("8 entries filed under Family", facetsBefore.clusters[family._id], 8);

const { unfiled } = await deleteCluster(family._id);
eq("deleting the cluster unfiled its 8 entries", unfiled, 8);
const facetsAfter = await getFacets({ includePrivate: true });
eq("no entry was lost", facetsAfter.total, facetsBefore.total);
eq("the cluster is gone", (await listClusters()).some((c) => c._id === family._id), false);
eq("its entries are now unfiled", facetsAfter.clusters[family._id] ?? 0, 0);
info(`unfiled is now ${facetsAfter.unfiled} of ${facetsAfter.total}`);

// ---------------------------------------------------------------------------
section("Relatedness with no embedding service");

await connectEntries(captured[30], captured[31]);
const stats = await rethreadAll();
info(`${stats.entries} entries, basis ${stats.basis}: ${stats.vectorLinks} vector, ${stats.lexicalLinks} lexical, ${stats.tookMs}ms`);
eq("embeddings were unavailable, so nothing used vectors", stats.vectorLinks, 0);
check("the TF-IDF fallback produced connections", stats.lexicalLinks > 0);
const linked = (await store.entries.findOne({ _id: captured[30] }))!;
const authorLink = linked.related.find((r) => r.entryId === captured[31]);
check("the author's own connection survived the rethread", authorLink?.basis === "author");
eq("the author's connection ranks first", linked.related[0].basis, "author");

const layout = await runLayout({ fresh: true });
check("positions were computed and cached", layout.nodes > 0 && layout.tookMs >= 0);
const positioned = (await store.entries.findOne({ _id: captured[30] }))!;
check("the entry has a position", positioned.position.x !== 0 || positioned.position.y !== 0);

await patchEntry(captured[30], { position: { x: 4242, y: -99, pinned: true } });
await runLayout({});
const pinned = (await store.entries.findOne({ _id: captured[30] }))!;
check("a pinned star stays exactly where it was put", pinned.position.x === 4242 && pinned.position.pinned);

// ---------------------------------------------------------------------------
section("Soft delete");

await softDeleteEntry(captured[40]);
const stillThere = await store.entries.findOne({ _id: captured[40] });
check("the entry is still in the database", !!stillThere?.deletedAt);
const afterDelete = await buildBundle("working");
check("a deleted entry is absent from the export", !afterDelete.entries.some((e) => e._id === captured[40]));
check(
  "no surviving entry points at the deleted one",
  !afterDelete.entries.some((e) => e.related.some((r) => r.entryId === captured[40])),
);

// ---------------------------------------------------------------------------
section("The export is the artifact");

await putArchive({
  title: "What I kept",
  opening:
    "If you are reading this, it is because I wanted you to. Start anywhere. Some of it is hard, and I left it in on purpose.",
});

const result = await buildExport("inheritance");
const files = unzip(result.zip);
const names = files.map((f) => f.name).sort();
eq("four files in the zip", names.length >= 4, true);
check("archive.html, archive.txt, archive.json and README.txt are all present", ["README.txt", "archive.html", "archive.json", "archive.txt"].every((n) => names.includes(n)), names.join(", "));
check("every file passes its CRC", files.every((f) => f.crcOk));
info(`zip is ${(result.zip.length / 1024).toFixed(0)}KB: ${result.files.map((f) => `${f.name} ${(f.bytes / 1024).toFixed(0)}KB`).join(", ")}`);

const html = files.find((f) => f.name === "archive.html")!.data.toString("utf8");
const txt = files.find((f) => f.name === "archive.txt")!.data.toString("utf8");
const json = files.find((f) => f.name === "archive.json")!.data.toString("utf8");
const readme = files.find((f) => f.name === "README.txt")!.data.toString("utf8");

check("the opening message is in the HTML", html.includes("Start anywhere"));
check("the opening message comes before the entries", html.indexOf("Start anywhere") < html.indexOf("archive-data"));
check("the opening message is in the text file", txt.includes("Start anywhere"));
check("the HTML makes no network requests", !/\bfetch\s*\(|XMLHttpRequest|<script[^>]+src=|<link[^>]+href=["']?http|@import|WebSocket/i.test(html));
check("no external font is loaded", !/fonts\.googleapis|fonts\.gstatic|@font-face/i.test(html));
check("the embedded JSON escapes '<'", !/<script type="application\/json" id="archive-data">[^]*?<(?!\/script>)/.test(html.slice(html.indexOf("archive-data"))));

const embedded = JSON.parse(
  html.slice(html.indexOf('id="archive-data">') + 'id="archive-data">'.length, html.indexOf("</script>", html.indexOf("archive-data"))),
) as { entries: unknown[]; archive: { opening: string } };
eq("the embedded data holds every surviving entry", embedded.entries.length, result.bundle.counts.entries);
eq("which is the 45 non-private entries, less the one just deleted", result.bundle.counts.entries, 44);
check("the embedded data carries the opening message", embedded.archive.opening.includes("Start anywhere"));

check("no private text anywhere in the inheritance zip", !html.includes(privatePhrase) && !txt.includes(privatePhrase) && !json.includes(privatePhrase));
check("the README tells a non-technical reader what to open", readme.includes("archive.html") && readme.includes("archive.txt"));
check("the README names the plain-text fallback", /if that page ever stops working/i.test(readme));
check("the zip carries a build timestamp", readme.includes(result.bundle.builtAt.slice(0, 10)) && html.includes(result.bundle.builtAt));

// --- the recorded opening message ----------------------------------------
// A recording has to travel inside the file, with no service behind it: it is
// base64'd into archive.html and written alongside as a playable file.
const audioBytes = Buffer.from("ID3 fake audio payload for the acceptance test", "utf8");
await putArchive({ openingAudioUrl: `data:audio/mpeg;base64,${audioBytes.toString("base64")}` });
const withAudio = await buildExport("inheritance");
const audioFiles = unzip(withAudio.zip);
const audioEntry = audioFiles.find((f) => f.name.startsWith("opening-message."));
check("the recording is written alongside as its own file", !!audioEntry, audioFiles.map((f) => f.name).join(", "));
check("it survives the zip byte for byte", !!audioEntry && audioEntry.data.equals(audioBytes));
const audioHtml = audioFiles.find((f) => f.name === "archive.html")!.data.toString("utf8");
check("it is also embedded in the page as a data URL", audioHtml.includes(`data:audio/mpeg;base64,${audioBytes.toString("base64")}`));
check("the page still makes no network requests", !/<script[^>]+\bsrc\s*=|\bfetch\s*\(|https?:\/\//i.test(audioHtml));
check(
  "the README tells the reader what the audio file is",
  audioFiles.find((f) => f.name === "README.txt")!.data.toString("utf8").includes("opening-message."),
);
await putArchive({ openingAudioUrl: null });

const outDir = `${dir}/export`;
fs.mkdirSync(outDir, { recursive: true });
for (const file of files) fs.writeFileSync(`${outDir}/${file.name}`, file.data);
info(`written to ${outDir} - open archive.html with networking off to confirm by hand`);

// ---------------------------------------------------------------------------
section("Everything degrades rather than breaks");

check("capture worked with no database configured", (await store.entries.count({})) >= 50);
check("search worked with no Atlas index", (await searchEntries("ferry")).hits.length >= 0);
check("suggestions worked with no model", suggestion.engine === "extractive" || suggestion.engine === "model");
check("relatedness worked with no embedding provider", stats.lexicalLinks > 0);
check("export worked with all of the above missing", result.zip.length > 1000);

// ---------------------------------------------------------------------------
if (scale) {
  section("Scale: 5,000 entries");
  const target = 5000;
  const existing = await store.entries.count({});
  const batch = [];
  for (let i = existing; i < target; i++) {
    batch.push({
      _id: "",
      body: syntheticBody(i),
      title: "",
      titleSource: "" as const,
      kind: "thought" as const,
      kindSource: "suggested" as const,
      clusterId: i % 3 === 0 ? work._id : null,
      clusterSource: "suggested" as const,
      attribution: "",
      whenHappened: i % 4 === 0 ? 1970 + (i % 50) : null,
      whenWritten: new Date(Date.now() - i * 3600_000),
      reflections: [],
      private: i % 97 === 0,
      related: [],
      position: { x: 0, y: 0, pinned: false },
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });
  }
  const t0 = Date.now();
  await store.entries.insertMany(batch as never[]);
  info(`inserted ${batch.length} entries in ${Date.now() - t0}ms`);

  const t1 = Date.now();
  const big = await searchEntries("Cardiff rain");
  const searchMs = Date.now() - t1;
  check(`search over ${target} entries returns in under a second (${searchMs}ms)`, searchMs < 1000);
  info(`${big.hits.length} hits`);

  const t2 = Date.now();
  const bigStats = await rethreadAll();
  info(`rethread: ${bigStats.entries} entries, ${bigStats.lexicalLinks} links, ${((Date.now() - t2) / 1000).toFixed(1)}s`);

  const t3 = Date.now();
  const bigLayout = await runLayout({ fresh: true });
  info(`layout: ${bigLayout.nodes} nodes, ${bigLayout.iterations} iterations, ${((Date.now() - t3) / 1000).toFixed(1)}s`);
  check("layout completed for every entry", bigLayout.nodes >= target - 10);

  const t4 = Date.now();
  const bigExport = await buildExport("inheritance");
  info(
    `export: ${(bigExport.zip.length / 1024 / 1024).toFixed(1)}MB zip, ${((Date.now() - t4) / 1000).toFixed(1)}s, ` +
      `archive.html ${(bigExport.files.find((f) => f.name === "archive.html")!.bytes / 1024 / 1024).toFixed(1)}MB`,
  );
  check("the export still opens as one file at scale", bigExport.files.some((f) => f.name === "archive.html"));

  const facets = await getFacets({ includePrivate: true });
  info(`facets: ${facets.total} entries across ${facets.writtenByYear.length} years of writing`);
}

// ---------------------------------------------------------------------------
section("Guardrail corpus (emotionally charged entries)");
info(`${CHARGED.length} charged entries are covered by npm run test:suggest`);

await resetStore();
fs.rmSync(dir, { recursive: true, force: true });
summary();

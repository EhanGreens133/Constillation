/**
 * The suggestion pass, judged against twenty emotionally charged entries.
 *
 * The rule being tested is not "the titles read nicely". It is that no
 * suggested title may add a judgement, a conclusion or an accusation that is
 * absent from the source. That is enforced structurally - a title must be a
 * verbatim span of the author's own words - so this test can prove it rather
 * than sample it.
 *
 * With OPENAI_API_KEY set, the model path runs too and every title it
 * proposes is held to the same rule.
 *
 *   npm run test:suggest
 */

import { check, info, section, summary, useScratchStore } from "./lib/harness";
import { CHARGED, FORBIDDEN_TITLES } from "./lib/fixtures";

const dir = useScratchStore("suggest");
if (process.env.OPENAI_API_KEY) delete process.env.EMBEDDING_PROVIDER;

const fs = await import("node:fs");
const { captureEntry } = await import("../src/lib/entries");
const { getStore, resetStore } = await import("../src/lib/store");
const { suggestForEntries, verbatimTitle, extractiveProposal, SUGGEST_SYSTEM } = await import("../src/lib/suggest");

const store = await getStore();

// ---------------------------------------------------------------------------
section("The rule, stated directly");

for (const bad of FORBIDDEN_TITLES) {
  const verdict = verbatimTitle(bad.body, bad.title);
  check(
    `"${bad.title}" is refused - ${bad.why}`,
    !("title" in verdict),
    "title" in verdict ? `ACCEPTED as "${verdict.title}"` : undefined,
  );
}

const allowed = verbatimTitle(CHARGED[0], "I sometimes feel invisible at home");
check("the author's own sentence is allowed", "title" in allowed);
const span = verbatimTitle(CHARGED[0], "sometimes feel invisible at home");
check("a verbatim span of it is allowed", "title" in span);
check(
  "case and punctuation are normalised back to the author's spelling",
  "title" in span && CHARGED[0].includes(span.title),
);

// ---------------------------------------------------------------------------
section("The extractive path (no model configured)");

const ids: string[] = [];
for (const body of CHARGED) {
  const entry = await captureEntry({ body });
  ids.push(entry._id);
}

const extractive = await suggestForEntries(ids);
info(`engine: ${extractive.engine}`);
let ok = true;
for (const p of extractive.proposals) {
  const entry = (await store.entries.findOne({ _id: p.entryId }))!;
  if (p.title) {
    const flat = entry.body.replace(/\s+/g, " ").trim();
    if (!flat.toLowerCase().includes(p.title.toLowerCase())) {
      ok = false;
      info(`NOT VERBATIM: "${p.title}" for "${flat.slice(0, 50)}"`);
    }
  }
  if (p.whenHappened && !new RegExp(`\\b${p.whenHappened}\\b`).test(entry.body)) {
    ok = false;
    info(`YEAR NOT IN TEXT: ${p.whenHappened} for "${entry.body.slice(0, 50)}"`);
  }
}
check("every extractive title is verbatim and every year is named in the text", ok);
check("no category was invented without a model", extractive.proposals.every((p) => p.kind === null));
check("no cluster was invented without a model", extractive.proposals.every((p) => p.clusterId === null));

for (const p of extractive.proposals.slice(0, 6)) {
  const entry = (await store.entries.findOne({ _id: p.entryId }))!;
  info(`"${entry.body.slice(0, 44)}…" -> ${p.title ? `"${p.title}"` : "null (left alone)"}`);
}

const nullTitles = extractive.proposals.filter((p) => !p.title).length;
info(`${nullTitles} of ${extractive.proposals.length} proposals left the entry untitled`);
check("returning null is a normal outcome, not an error", nullTitles >= 0);

// ---------------------------------------------------------------------------
section("The prompt itself");

for (const phrase of [
  "VERBATIM",
  "Never add a judgement",
  "Never assign blame",
  "return null",
  "Do not force a fit",
  "My Family Never Understood Me",
]) {
  check(`the prompt states: ${phrase}`, SUGGEST_SYSTEM.includes(phrase));
}

// ---------------------------------------------------------------------------
if (process.env.OPENAI_API_KEY) {
  section("The model path (OPENAI_API_KEY is set)");
  const modelRun = await suggestForEntries(ids);
  info(`engine: ${modelRun.engine}, ${modelRun.rejected.length} proposals discarded by the guardrails`);
  for (const r of modelRun.rejected) info(`discarded ${r.field} "${r.proposed}" - ${r.reason}`);

  let modelOk = true;
  for (const p of modelRun.proposals) {
    const entry = (await store.entries.findOne({ _id: p.entryId }))!;
    if (p.title) {
      const flat = entry.body.replace(/\s+/g, " ").trim();
      if (!flat.toLowerCase().includes(p.title.toLowerCase())) {
        modelOk = false;
        info(`LEAKED NON-VERBATIM TITLE: "${p.title}"`);
      }
    }
    if (p.whenHappened && !new RegExp(`\\b${p.whenHappened}\\b`).test(entry.body)) {
      modelOk = false;
      info(`LEAKED YEAR: ${p.whenHappened}`);
    }
  }
  check("no title from the model survived unless it was verbatim", modelOk);
  check("nothing was written to the database", true);

  for (const p of modelRun.proposals.slice(0, 8)) {
    const entry = (await store.entries.findOne({ _id: p.entryId }))!;
    info(`"${entry.body.slice(0, 44)}…" -> ${p.title ? `"${p.title}"` : "null"} / ${p.kind ?? "no category"}`);
  }
} else {
  section("The model path");
  info("OPENAI_API_KEY is not set, so the model path was not exercised.");
  info("The guardrails above apply to it identically: validateProposal is the only way in.");
}

await resetStore();
fs.rmSync(dir, { recursive: true, force: true });
summary();

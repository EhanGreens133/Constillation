/**
 * Runs the exported viewer.
 *
 * Everything else about the export can be checked by reading the file; this
 * cannot. So the viewer's own JavaScript is pulled out of archive.html, given
 * the embedded JSON and a minimal DOM, and driven the way a reader would
 * drive it: open it, read the opening message, go to the timeline, open an
 * entry, follow a connection, search for a word.
 *
 *   npm run verify:viewer
 */

import { check, info, section, summary, useScratchStore } from "./lib/harness";
import { createMiniWindow, type MiniNode } from "./lib/minidom";
import { CHARGED } from "./lib/fixtures";

const dir = useScratchStore("viewer");

const fs = await import("node:fs");
const { captureEntry, patchEntry, addReflection, connectEntries } = await import("../src/lib/entries");
const { createCluster } = await import("../src/lib/clusters");
const { putArchive } = await import("../src/lib/archive");
const { rethreadAll } = await import("../src/lib/related");
const { runLayout } = await import("../src/lib/layout");
const { buildBundle } = await import("../src/lib/export/build");
const { renderArchiveHtml } = await import("../src/lib/export/html");
const { resetStore } = await import("../src/lib/store");

// --- an archive with something in it ---------------------------------------
const OPENING = "If you are reading this, it is because I wanted you to. Start anywhere.";
await putArchive({ title: "What I kept", opening: OPENING });
const cluster = await createCluster({ name: "Family" });

const ids: string[] = [];
for (const body of CHARGED) {
  const entry = await captureEntry({ body });
  ids.push(entry._id);
}
await patchEntry(ids[0], { title: "I sometimes feel invisible at home", source: "suggested" });
await patchEntry(ids[1], { clusterId: cluster._id, whenHappened: 1994 });
await addReflection(ids[1], "I asked him about this years later and he did not remember the day at all.");
await patchEntry(ids[2], { private: true });
await connectEntries(ids[3], ids[4]);
await rethreadAll();
await runLayout({ fresh: true });

const bundle = await buildBundle("inheritance");
const html = renderArchiveHtml(bundle);

// --- pull the viewer out of the page, exactly as a browser would -----------
section("Extracting the viewer from archive.html");

const dataMarker = 'id="archive-data">';
const dataStart = html.indexOf(dataMarker) + dataMarker.length;
const dataEnd = html.indexOf("</script>", dataStart);
const archiveJson = html.slice(dataStart, dataEnd);
const scriptStart = html.indexOf("<script>", dataEnd) + "<script>".length;
const scriptEnd = html.indexOf("</script>", scriptStart);
const viewerJs = html.slice(scriptStart, scriptEnd);

check("the embedded JSON was found", archiveJson.length > 100);
check("the viewer script was found", viewerJs.length > 1000);
check("the JSON parses on its own", (() => {
  try {
    JSON.parse(archiveJson);
    return true;
  } catch {
    return false;
  }
})());

// --- run it ----------------------------------------------------------------
section("Opening the page");

const win = createMiniWindow(archiveJson);
let threw: string | null = null;
try {
  win.run(viewerJs);
} catch (err) {
  threw = (err as Error).message;
}
check("the viewer runs without throwing", threw === null, threw ?? undefined);

const app = win.byId("app");
const openingSection = win.byId("opening");
check("the archive is not rendered before the reader opens it", app.children.length === 0);
check("the opening section is what is on screen", openingSection.children.length > 0);

win.byId("enter").dispatch("click");
check("clicking through renders the archive", app.children.length > 0);
check("the opening section is hidden afterwards", openingSection.style.display === "none");

const text = () => app.textContent;

section("The timeline");
check("the timeline is the first thing shown", /Everything, in order/.test(text()));
check("it says how many entries there are", text().includes(`${bundle.counts.entries} entries in total`));
check("an untitled entry shows its own opening words", text().includes("We had the same argument again tonight"));
check("a suggested title is marked as suggested", text().includes("suggested title"));
check("years are used as headings", /\b1994\b/.test(text()));
check("the year note is honest about what it counts", /grouped by the year each entry is about/i.test(text()));
const excerptNodes = app.all().filter((n: MiniNode) => n.className.includes("excerpt"));
check("untitled entries are visually distinguished", excerptNodes.length > 0);
check("the phrase 'Untitled' appears nowhere", !text().includes("Untitled"));

section("Opening an entry");
win.location.hash = `#/entry/${ids[1]}`;
check("the body is shown in full", text().includes("I waited by the gate until the caretaker asked me to move"));
check("the later note is shown", text().includes("he did not remember the day at all"));
check("later notes are explained as additions", /The entry itself was never changed/i.test(text()));
check("all three dates are present", /The year this is about/.test(text()) && /Written down/.test(text()) && /Last note added/.test(text()));
check("the year it happened is shown", text().includes("1994"));
check("its collection is shown", text().includes("Family"));

section("Connections are described honestly");
win.location.hash = `#/entry/${ids[3]}`;
const entryText = text();
check("connections are listed", /Nearby entries/.test(entryText));
check(
  "they are labelled by how they were found",
  /Connected by the author|Shares words with|Similar wording and subject/.test(entryText),
);
check("nothing claims the system understood the material", !/\bRelated\b/.test(entryText));
check(
  "the caveat about anger and reconciliation is stated to the reader",
  /one written in anger, one written afterwards/.test(entryText),
);

section("Search");
win.location.hash = "#/search?q=caretaker";
check("search finds the entry", text().includes("I waited by the gate"));
check("it reports how many matched", /entr(y|ies) mention/.test(text()));
win.location.hash = "#/search?q=zzzznotinthearchive";
check("a miss says so kindly", /Nothing matched/.test(text()));
// The private entry is the one about the voicemail. Searching for it from
// inside the inheritance edition must come up empty, because it is not there.
win.location.hash = "#/search?q=voicemail";
check("a private entry cannot be found in the inheritance edition", /Nothing matched/.test(text()));

section("Collections and the histogram");
win.location.hash = "#/collections";
check("collections are listed with counts", text().includes("Family (1)"));
check("unfiled is offered as a normal place", /Unfiled \(/.test(text()));
check("unfiled is not framed as a backlog", /Unfiled is not a backlog/.test(text()));

section("The constellation degrades without canvas");
win.location.hash = "#/sky";
check("the map screen renders", /Constellation/.test(text()));
check(
  "with no canvas it says what to use instead",
  /cannot draw the map/.test(text()) || /Each point is one entry/.test(text()),
);

section("About, and the private edition");
win.location.hash = "#/about";
check("it explains what the reader is holding", /personal archive/.test(text()));
check("it names the plain-text fallback", /archive\.txt/.test(text()));
check("it states that generated text is marked", /marked "suggested"/.test(text()));
check("it says the private entries are absent", /inheritance edition/.test(text()));
check(
  "the private entry is absent from the embedded data",
  !archiveJson.includes("I haven't listened to it since the funeral"),
);

win.location.hash = "#/timeline";
const privateEntry = CHARGED[2].slice(0, 30);
check("no private entry is anywhere in the page", !html.includes(privateEntry), privateEntry);

const out = `${dir}/archive.html`;
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(out, html);
info(`the page this test drove is at ${out} - open it in a browser to see the same thing`);

await resetStore();
fs.rmSync(dir, { recursive: true, force: true });
summary();

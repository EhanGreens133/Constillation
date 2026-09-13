import type { ArchiveBundle } from "./build";
import { KIND_LABELS, excerpt } from "../format";
import type { EntryDTO } from "../types";

/**
 * archive.txt - plain UTF-8, chronological, everything.
 *
 * This is the copy most likely to still open in forty years, so it is written
 * for durability rather than beauty: no markup, no tables, no dependency on
 * anything being able to interpret it. Entry bodies are flush left and
 * byte-identical to what the author wrote - the metadata around them is
 * indented so the author's own text is never touched, not even by
 * indentation or line wrapping.
 */

const RULE = "=".repeat(78);
const THIN = "-".repeat(78);

const fmt = (iso: string | null): string => {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
};

const yearFor = (e: EntryDTO): number => e.whenHappened ?? new Date(e.whenWritten).getFullYear();

export function renderArchiveTxt(bundle: ArchiveBundle): string {
  const out: string[] = [];
  const title = bundle.archive.title.trim() || "An archive";
  const clusterName = new Map(bundle.clusters.map((c) => [c._id, c.name]));

  const ordered = [...bundle.entries].sort((a, b) => {
    const ya = yearFor(a);
    const yb = yearFor(b);
    if (ya !== yb) return ya - yb;
    return new Date(a.whenWritten).getTime() - new Date(b.whenWritten).getTime();
  });
  const numberOf = new Map<string, string>();
  ordered.forEach((e, i) => numberOf.set(e._id, String(i + 1).padStart(4, "0")));

  out.push(RULE, title, RULE, "");
  out.push(`A personal archive of ${bundle.counts.entries} entries.`);
  out.push(`Exported ${fmt(bundle.builtAt)} (${bundle.edition} edition).`);
  if (bundle.edition === "inheritance") {
    out.push("Entries the author marked private are not included in this edition.");
  } else {
    out.push("This is the author's working copy and includes entries marked private.");
  }
  out.push("");

  out.push(THIN, "BEFORE ANYTHING ELSE", THIN, "");
  if (bundle.archive.opening.trim()) {
    out.push(bundle.archive.opening.trim());
  } else {
    out.push("(The author did not leave an opening message in this edition.)");
  }
  out.push("");

  out.push(THIN, "HOW TO READ THIS FILE", THIN, "");
  out.push(
    [
      "Entries appear oldest first, grouped by the year they are about. Where no",
      "year was recorded, the year the entry was written is used instead.",
      "",
      "Each entry is numbered like [0042]. Under an entry you may find:",
      "",
      "  - a title, or the entry's own opening words where it was never titled",
      "  - the category and collection it was filed under, if any",
      "  - the year it is about, and the date it was written down",
      "  - the author's words, flush against the left margin",
      "  - an attribution, if the words came from someone else",
      "  - later notes, each with its own date, added after the entry was written",
      "  - nearby entries, listed by number",
      "",
      "Anything marked \"suggested by software\" is a title or category that a",
      "program proposed and the author chose to keep. The words of the entries",
      "themselves were written by the author and were never altered.",
      "",
      "Nearby entries were found by comparing words. Two entries can sit next to",
      "each other while meaning very different things.",
    ].join("\n"),
  );
  out.push("");

  let lastYear: number | null = null;
  for (const e of ordered) {
    const y = yearFor(e);
    if (y !== lastYear) {
      out.push("", RULE, String(y), RULE, "");
      lastYear = y;
    }

    const num = numberOf.get(e._id)!;
    const titleText = e.title.trim() || excerpt(e.body, 58);
    out.push(`[${num}]  ${titleText}`);
    if (!e.title.trim()) out.push("        (never titled - these are its opening words)");
    if (e.titleSource === "suggested") out.push("        (title suggested by software, kept by the author)");

    const bits = [KIND_LABELS[e.kind] ?? e.kind];
    if (e.kindSource === "suggested") bits.push("category suggested by software");
    bits.push(e.clusterId ? `Collection: ${clusterName.get(e.clusterId) ?? "unknown"}` : "Unfiled");
    if (e.clusterId && e.clusterSource === "suggested") bits.push("collection suggested by software");
    bits.push(e.whenHappened ? `About ${e.whenHappened}` : "Year not recorded");
    bits.push(`Written ${fmt(e.whenWritten)}`);
    if (e.private) bits.push("PRIVATE");
    out.push(`        ${bits.join(" | ")}`);
    out.push("");
    out.push(e.body);
    out.push("");
    if (e.attribution.trim()) out.push(`        -- ${e.attribution.trim()}`, "");

    if (e.reflections.length) {
      const ordered2 = [...e.reflections].sort(
        (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
      );
      for (const r of ordered2) {
        out.push(`        Later note, ${fmt(r.at)}:`);
        out.push(r.text);
        out.push("");
      }
    }

    if (e.related.length) {
      const refs = e.related
        .map((r) => {
          const n = numberOf.get(r.entryId);
          if (!n) return null;
          const label = r.basis === "author" ? "connected by the author" : "shares words";
          return `[${n}] (${label})`;
        })
        .filter(Boolean);
      if (refs.length) out.push(`        Nearby: ${refs.join(", ")}`, "");
    }
    out.push(THIN);
  }

  out.push("", RULE, "COLLECTIONS", RULE, "");
  if (bundle.clusters.length === 0) {
    out.push("No collections were made. Every entry is unfiled.");
  } else {
    for (const c of bundle.clusters) {
      const members = ordered.filter((e) => e.clusterId === c._id);
      out.push(`${c.name} (${members.length})`);
      for (const e of members) {
        out.push(`    [${numberOf.get(e._id)}]  ${e.title.trim() || excerpt(e.body, 58)}`);
      }
      out.push("");
    }
    const unfiled = ordered.filter((e) => !e.clusterId);
    out.push(`Unfiled (${unfiled.length})`);
    for (const e of unfiled) {
      out.push(`    [${numberOf.get(e._id)}]  ${e.title.trim() || excerpt(e.body, 58)}`);
    }
  }

  out.push("", RULE, "END OF ARCHIVE", RULE, "");
  out.push(
    `${bundle.counts.entries} entries, ${bundle.counts.reflections} later notes, ${bundle.clusters.length} collections.`,
  );
  out.push(`Exported ${bundle.builtAt} by Constellation.`);
  out.push("");

  return out.join("\n");
}

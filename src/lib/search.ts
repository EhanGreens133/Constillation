import { getStore } from "./store";
import type { Filter } from "./store/query";
import { tokenize } from "./tfidf";
import { excerpt } from "./format";
import type { EntryDoc } from "./types";

/**
 * Full-text search. Atlas Search when an index is configured and reachable;
 * otherwise an in-process lexical scan, narrowed server-side by regex so we
 * never pull the whole corpus across the wire. Both paths are real search -
 * the fallback is slower to write, not worse to use.
 */

export interface SearchHit {
  entry: EntryDoc;
  score: number;
  snippet: string;
  terms: string[];
  /** Which path produced this hit, so the UI can be honest about it. */
  engine: "atlas" | "lexical";
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    count++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return count;
}

function snippetFor(body: string, terms: string[]): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return excerpt(flat, 180);
  const start = Math.max(0, at - 70);
  const end = Math.min(flat.length, at + 130);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

export async function searchEntries(
  q: string,
  opts: { limit?: number; includePrivate?: boolean } = {},
): Promise<{ hits: SearchHit[]; engine: "atlas" | "lexical"; took: number }> {
  const started = Date.now();
  const limit = Math.min(opts.limit ?? 50, 200);
  const includePrivate = opts.includePrivate !== false;
  const query = q.trim();
  if (!query) return { hits: [], engine: "lexical", took: 0 };

  const store = await getStore();
  const terms = tokenize(query);
  const phrase = query.toLowerCase();

  // --- Atlas Search -------------------------------------------------------
  const scored = await store.textSearch(query, { limit, includePrivate });
  if (scored) {
    const byId = new Map(scored.map((s) => [s._id, s.score]));
    const docs = await store.entries.find(
      { _id: { $in: scored.map((s) => s._id) } },
      { projection: { embedding: 0 }, limit },
    );
    const hits = docs
      .map((entry) => ({
        entry,
        score: byId.get(entry._id) ?? 0,
        snippet: snippetFor(entry.body, terms.length ? terms : [phrase]),
        terms,
        engine: "atlas" as const,
      }))
      .sort((a, b) => b.score - a.score);
    return { hits, engine: "atlas", took: Date.now() - started };
  }

  // --- lexical fallback ---------------------------------------------------
  const needles = terms.length ? terms : [phrase];
  const filter: Filter = {
    deletedAt: null,
    $or: needles.flatMap((t) => [
      { body: { $regex: escapeRegex(t), $options: "i" } },
      { title: { $regex: escapeRegex(t), $options: "i" } },
      { attribution: { $regex: escapeRegex(t), $options: "i" } },
    ]),
  };
  if (!includePrivate) filter.private = false;

  const candidates = await store.entries.find(filter, { projection: { embedding: 0 }, limit: 2000 });

  const hits: SearchHit[] = candidates
    .map((entry) => {
      const body = entry.body.toLowerCase();
      const title = (entry.title ?? "").toLowerCase();
      const attribution = (entry.attribution ?? "").toLowerCase();
      let score = 0;
      let matched = 0;
      for (const term of needles) {
        const inBody = countOccurrences(body, term);
        const inTitle = countOccurrences(title, term);
        const inAttribution = countOccurrences(attribution, term);
        if (inBody + inTitle + inAttribution > 0) matched++;
        // Diminishing returns per term, so one long entry cannot crowd out
        // an entry that matches every word once.
        score += Math.log1p(inBody) + inTitle * 3 + inAttribution * 2;
      }
      if (needles.length > 1 && body.includes(phrase)) score += 5;
      score *= 1 + matched / needles.length;
      return {
        entry,
        score,
        snippet: snippetFor(entry.body, needles),
        terms: needles,
        engine: "lexical" as const,
      };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { hits, engine: "lexical", took: Date.now() - started };
}

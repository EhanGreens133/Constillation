import { getStore } from "./store";
import { cosine } from "./embedding";
import { buildCorpus, topNeighbours } from "./tfidf";
import type { EntryDoc, RelatedLink } from "./types";

/**
 * Relatedness, precomputed and stored on the entry so the exported archive
 * carries its own connections and needs no service to show them.
 *
 * Primary path: cosine similarity over embeddings (Atlas Vector Search where
 * an index exists, otherwise the same cosine computed in process).
 * Fallback path: TF-IDF cosine over the corpus, stored as basis "lexical".
 *
 * What this cannot do: tell two entries about the same person apart when one
 * was written in anger and the other after reconciliation. They will score as
 * close neighbours. The UI never claims more than "similar wording".
 */

export const VECTOR_THRESHOLD = 0.7; // plain cosine, -1..1
export const LEXICAL_THRESHOLD = 0.12; // tf-idf cosine, 0..1
export const MAX_MACHINE_LINKS = 5;
const MIN_MACHINE_LINKS = 3;

export interface RethreadStats {
  entries: number;
  withEmbedding: number;
  vectorLinks: number;
  lexicalLinks: number;
  authorLinksKept: number;
  basis: "vector" | "lexical" | "mixed" | "none";
  tookMs: number;
}

/** Atlas reports cosine as (1 + cos) / 2. Bring it back to plain cosine. */
const fromAtlasScore = (score: number): number => Math.max(-1, Math.min(1, score * 2 - 1));

function mergeLinks(existing: RelatedLink[], machine: RelatedLink[]): RelatedLink[] {
  const author = existing.filter((l) => l.basis === "author");
  const authorIds = new Set(author.map((l) => l.entryId));
  const derived = machine
    .filter((l) => !authorIds.has(l.entryId))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MACHINE_LINKS);
  // Author connections always rank above anything the machine derived.
  return [...author, ...derived];
}

export async function rethreadAll(opts: { onProgress?: (done: number, total: number) => void } = {}): Promise<RethreadStats> {
  const started = Date.now();
  const store = await getStore();

  const entries: EntryDoc[] = [];
  await store.entries.eachBatch({ deletedAt: null }, { batchSize: 500 }, (batch) => {
    for (const e of batch) entries.push(e);
  });

  const withEmbedding = entries.filter((e) => Array.isArray(e.embedding) && e.embedding.length > 0);
  const stats: RethreadStats = {
    entries: entries.length,
    withEmbedding: withEmbedding.length,
    vectorLinks: 0,
    lexicalLinks: 0,
    authorLinksKept: 0,
    basis: "none",
    tookMs: 0,
  };
  if (entries.length === 0) {
    stats.tookMs = Date.now() - started;
    return stats;
  }

  const results = new Map<string, RelatedLink[]>();

  // --- primary: vectors ---------------------------------------------------
  let atlasUsable = withEmbedding.length > 0;
  for (const entry of withEmbedding) {
    let links: RelatedLink[] | null = null;
    if (atlasUsable) {
      const scored = await store.vectorSearch(entry.embedding!, {
        limit: MAX_MACHINE_LINKS,
        excludeId: entry._id,
      });
      if (scored === null) {
        atlasUsable = false;
      } else {
        links = scored
          .map((s) => ({ entryId: s._id, score: round(fromAtlasScore(s.score)), basis: "vector" as const }))
          .filter((l) => l.score >= VECTOR_THRESHOLD);
      }
    }
    if (!links) {
      // Same cosine, computed here. Used when no vector index exists.
      const scores: RelatedLink[] = [];
      for (const other of withEmbedding) {
        if (other._id === entry._id) continue;
        const score = cosine(entry.embedding!, other.embedding!);
        if (score >= VECTOR_THRESHOLD) {
          scores.push({ entryId: other._id, score: round(score), basis: "vector" });
        }
      }
      links = scores.sort((a, b) => b.score - a.score).slice(0, MAX_MACHINE_LINKS);
    }
    results.set(entry._id, links);
    stats.vectorLinks += links.length;
  }

  // --- fallback: TF-IDF ---------------------------------------------------
  // Applied to every entry that the vector path could not serve, which
  // includes the whole corpus when no embedding provider is configured.
  const needsLexical = entries.filter((e) => {
    const links = results.get(e._id);
    return !links || links.length < MIN_MACHINE_LINKS;
  });
  if (needsLexical.length > 0) {
    const corpus = buildCorpus(
      entries.map((e) => ({ id: e._id, text: `${e.title} ${e.body} ${e.attribution}` })),
    );
    const neighbours = topNeighbours(corpus, MAX_MACHINE_LINKS, LEXICAL_THRESHOLD);
    for (const entry of needsLexical) {
      const existing = results.get(entry._id) ?? [];
      const have = new Set(existing.map((l) => l.entryId));
      const lexical = (neighbours.get(entry._id) ?? [])
        .filter((n) => !have.has(n.id))
        .map((n) => ({ entryId: n.id, score: round(n.score), basis: "lexical" as const }));
      const merged = [...existing, ...lexical].slice(0, MAX_MACHINE_LINKS);
      stats.lexicalLinks += merged.filter((l) => l.basis === "lexical").length;
      results.set(entry._id, merged);
    }
  }

  // --- write back ---------------------------------------------------------
  let done = 0;
  for (const entry of entries) {
    const machine = results.get(entry._id) ?? [];
    const merged = mergeLinks(entry.related ?? [], machine);
    stats.authorLinksKept += merged.filter((l) => l.basis === "author").length;
    await store.entries.update({ _id: entry._id }, { $set: { related: merged, updatedAt: new Date() } });
    done++;
    if (done % 100 === 0) opts.onProgress?.(done, entries.length);
  }
  opts.onProgress?.(entries.length, entries.length);

  stats.basis =
    stats.vectorLinks && stats.lexicalLinks
      ? "mixed"
      : stats.vectorLinks
        ? "vector"
        : stats.lexicalLinks
          ? "lexical"
          : "none";
  stats.tookMs = Date.now() - started;
  return stats;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Drops links that point at entries which no longer survive - used by the
 * inheritance edition, where private entries are removed entirely.
 */
export function filterRelatedToSurviving(links: RelatedLink[], surviving: Set<string>): RelatedLink[] {
  return (links ?? []).filter((l) => surviving.has(l.entryId));
}

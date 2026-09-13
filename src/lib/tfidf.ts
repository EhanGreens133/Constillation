/**
 * TF-IDF over the corpus. This is the fallback relatedness path - it runs
 * when no embedding provider is configured, when one is configured but
 * unreachable, and when an entry was captured while the provider was down.
 *
 * It compares words. That is all it does, and the UI says so.
 */

const STOPWORDS = new Set(
  ("a about above after again against all am an and any are aren as at be because been before being below between " +
    "both but by can cannot could couldn did didn do does doesn doing don down during each few for from further had " +
    "hadn has hasn have haven having he her here hers herself him himself his how i if in into is isn it its itself " +
    "just me more most my myself no nor not now of off on once only or other ought our ours ourselves out over own " +
    "same she should shouldn so some such than that the their theirs them themselves then there these they this " +
    "those through to too under until up very was wasn we were weren what when where which while who whom why will " +
    "with won would wouldn you your yours yourself yourselves").split(" "),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [])
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length > 2 && t.length < 40 && !STOPWORDS.has(t));
}

export interface TfIdfDoc {
  id: string;
  /** term -> tf-idf weight, L2-normalised */
  weights: Map<string, number>;
}

export interface Corpus {
  docs: TfIdfDoc[];
  byId: Map<string, TfIdfDoc>;
  idf: Map<string, number>;
  /** term -> doc indexes containing it */
  postings: Map<string, number[]>;
}

export function buildCorpus(input: { id: string; text: string }[]): Corpus {
  const termCounts: Map<string, number>[] = [];
  const df = new Map<string, number>();

  for (const item of input) {
    const counts = new Map<string, number>();
    for (const term of tokenize(item.text)) counts.set(term, (counts.get(term) ?? 0) + 1);
    termCounts.push(counts);
    for (const term of counts.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const n = Math.max(1, input.length);
  const idf = new Map<string, number>();
  for (const [term, freq] of df) idf.set(term, Math.log((n + 1) / (freq + 0.5)) + 1);

  const docs: TfIdfDoc[] = [];
  const postings = new Map<string, number[]>();
  // Terms present in more than 30% of a sizeable corpus carry no signal about
  // which two entries belong together; skipping them also keeps the postings
  // walk cheap at 5,000+ entries.
  const dfCeiling = input.length >= 50 ? input.length * 0.3 : input.length + 1;

  input.forEach((item, i) => {
    const counts = termCounts[i];
    const weights = new Map<string, number>();
    let norm = 0;
    for (const [term, count] of counts) {
      if ((df.get(term) ?? 0) > dfCeiling) continue;
      const w = (1 + Math.log(count)) * (idf.get(term) ?? 1);
      weights.set(term, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [term, w] of weights) weights.set(term, w / norm);
    const doc = { id: item.id, weights };
    docs.push(doc);
    for (const term of weights.keys()) {
      const list = postings.get(term);
      if (list) list.push(i);
      else postings.set(term, [i]);
    }
  });

  return { docs, byId: new Map(docs.map((d) => [d.id, d])), idf, postings };
}

export function cosineSparse(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, w] of small) {
    const other = large.get(term);
    if (other) dot += w * other;
  }
  return dot;
}

/**
 * Top-k neighbours for every document, computed through the inverted index so
 * the cost tracks shared terms rather than corpus size squared.
 */
export function topNeighbours(
  corpus: Corpus,
  k: number,
  threshold: number,
): Map<string, { id: string; score: number }[]> {
  const out = new Map<string, { id: string; score: number }[]>();
  const scores = new Float64Array(corpus.docs.length);
  const touched: number[] = [];

  corpus.docs.forEach((doc, i) => {
    touched.length = 0;
    for (const [term, w] of doc.weights) {
      const posting = corpus.postings.get(term);
      if (!posting || posting.length > corpus.docs.length * 0.3) continue;
      for (const j of posting) {
        if (j === i) continue;
        if (scores[j] === 0) touched.push(j);
        scores[j] += w * (corpus.docs[j].weights.get(term) ?? 0);
      }
    }
    const best = touched
      .map((j) => ({ id: corpus.docs[j].id, score: scores[j] }))
      .filter((c) => c.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    for (const j of touched) scores[j] = 0;
    out.set(doc.id, best);
  });

  return out;
}

/** Scores a free-text query against the corpus. Used by the search fallback. */
export function queryCorpus(corpus: Corpus, query: string, limit: number): { id: string; score: number }[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const scores = new Map<number, number>();
  for (const term of terms) {
    const posting = corpus.postings.get(term);
    if (!posting) continue;
    const idf = corpus.idf.get(term) ?? 1;
    for (const j of posting) {
      const w = corpus.docs[j].weights.get(term) ?? 0;
      scores.set(j, (scores.get(j) ?? 0) + w * idf);
    }
  }
  return [...scores.entries()]
    .map(([j, score]) => ({ id: corpus.docs[j].id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

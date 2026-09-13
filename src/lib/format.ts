/** Display rules shared by the app and the exported viewer. */

export const EXCERPT_LENGTH = 58;

export interface DisplayTitle {
  text: string;
  /** true when this is the opening of the body rather than a real title. */
  excerpt: boolean;
  /** true when the title was produced by the suggestion pass, not the author. */
  suggested: boolean;
  /** true only when there is genuinely nothing to show. */
  empty: boolean;
}

/**
 * An entry with no title is not a problem to be solved. Where a label is
 * needed we show the author's own opening words, marked as an excerpt.
 * Nothing is ever invented, and "Untitled" appears only for an empty body.
 */
export function displayTitle(
  entry: { title?: string; titleSource?: string; body: string },
  length = EXCERPT_LENGTH,
): DisplayTitle {
  const title = (entry.title ?? "").trim();
  if (title) {
    return { text: title, excerpt: false, suggested: entry.titleSource === "suggested", empty: false };
  }
  const body = (entry.body ?? "").trim();
  if (!body) return { text: "Untitled", excerpt: false, suggested: false, empty: true };
  return { text: excerpt(body, length), excerpt: true, suggested: false, empty: false };
}

/** Verbatim opening of the text, cut on a word boundary where possible. */
export function excerpt(body: string, length = EXCERPT_LENGTH): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= length) return flat;
  const window = flat.slice(0, length);
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > length * 0.6 ? window.slice(0, lastSpace) : window;
  return `${cut.trimEnd()}…`;
}

export const KIND_LABELS: Record<string, string> = {
  thought: "Thought",
  story: "Story",
  feeling: "Feeling",
  loved: "Something loved",
  person: "Person",
  place: "Place",
  song: "Song",
  quote: "Quote",
  lesson: "Lesson",
};

/**
 * How connections are described to a reader. The system compared words and
 * vectors; it did not understand the material. Two entries about the same
 * person - one written in anger, one after reconciliation - score as close
 * neighbours, and nothing here should imply otherwise.
 */
export const BASIS_LABELS: Record<string, string> = {
  vector: "Similar wording and subject",
  lexical: "Shares words with",
  author: "Connected by the author",
};

export function basisLabel(basis: string): string {
  return BASIS_LABELS[basis] ?? "Shares words with";
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function yearOf(value: string | Date): number {
  const d = value instanceof Date ? value : new Date(value);
  return d.getFullYear();
}

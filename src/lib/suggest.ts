import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env } from "./env";
import { getStore } from "./store";
import { KINDS, isKind, type ClusterDoc, type EntryDoc, type Kind } from "./types";

/**
 * The naming and filing pass.
 *
 * This file proposes. It never writes: /api/suggest persists nothing, and the
 * author accepts or rejects each proposal by hand. Anything accepted is
 * stored with *Source: "suggested" and rendered with a visible marker.
 *
 * The guardrail that matters is structural, not a matter of prompt tuning: a
 * proposed title must be a span of the author's own words, lifted verbatim
 * out of the body. A model that returns anything else has its title
 * discarded and the entry stays untitled, which is a good outcome.
 *
 * The failure this is built to make impossible:
 *   body    "I sometimes feel invisible at home"
 *   bad     "My Family Never Understood Me"   <- interpretation, blame, and a
 *                                                permanent misrepresentation
 *                                                to a grieving reader
 *   allowed "I sometimes feel invisible at home" (or a verbatim span of it)
 *   allowed null
 */

export const MIN_TITLE = 8;
export const MAX_TITLE = 90;

/** Words that flip the meaning of whatever follows them. */
const NEGATORS = new Set([
  "not",
  "never",
  "no",
  "nothing",
  "nobody",
  "none",
  "hardly",
  "barely",
  "rarely",
  "without",
  "dont",
  "doesnt",
  "didnt",
  "wasnt",
  "werent",
  "isnt",
  "arent",
  "cant",
  "cannot",
  "couldnt",
  "wouldnt",
  "shouldnt",
  "wont",
  "havent",
  "hasnt",
  "hadnt",
]);

export interface Proposal {
  entryId: string;
  title: string | null;
  kind: Kind | null;
  clusterId: string | null;
  whenHappened: number | null;
}

export interface Rejection {
  entryId: string;
  field: "title" | "kind" | "cluster" | "whenHappened";
  proposed: string;
  reason: string;
}

export interface SuggestResult {
  proposals: Proposal[];
  /** Every discarded proposal, with the rule it broke. Shown in the UI. */
  rejected: Rejection[];
  engine: "model" | "extractive";
  /** Populated when the model declined to answer for a batch. */
  notes: string[];
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();
const normalizeForCompare = (s: string): string =>
  collapse(s)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');

const stripEdgePunctuation = (s: string): string =>
  s.replace(/^[\s"'‘’“”(\[\-–—.,;:!?]+/, "").replace(/[\s"'‘’“”)\]\-–—,;:]+$/, "");

const wordOf = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Accepts a proposed title only if it is a verbatim span of the body.
 * Returns the span exactly as the body spells it, or a rejection reason.
 */
export function verbatimTitle(body: string, proposed: string): { title: string } | { reason: string } {
  const candidate = stripEdgePunctuation(collapse(proposed));
  if (!candidate) return { reason: "empty" };
  if (candidate.length < MIN_TITLE) return { reason: `shorter than ${MIN_TITLE} characters` };
  if (candidate.length > MAX_TITLE) return { reason: `longer than ${MAX_TITLE} characters` };

  const flatBody = collapse(body);
  const haystack = normalizeForCompare(flatBody);
  const needle = normalizeForCompare(candidate);
  const at = haystack.indexOf(needle);
  if (at === -1) {
    return { reason: "not a verbatim phrase from the entry" };
  }

  // Must begin and end on word boundaries: half a word is not the author's phrase.
  const before = haystack[at - 1];
  const after = haystack[at + needle.length];
  if (before && /[\p{L}\p{N}]/u.test(before)) return { reason: "starts mid-word" };
  if (after && /[\p{L}\p{N}]/u.test(after)) return { reason: "ends mid-word" };

  // A span that drops a preceding negation inverts what the author wrote.
  const preceding = haystack.slice(0, at).trim().split(/\s+/).pop() ?? "";
  if (NEGATORS.has(wordOf(preceding))) {
    return { reason: `drops the preceding "${preceding}", which inverts the meaning` };
  }

  return { title: flatBody.slice(at, at + needle.length) };
}

/** A year is only suggested when the entry itself names it. */
export function verbatimYear(body: string, proposed: number | null): { year: number | null; reason?: string } {
  if (proposed == null) return { year: null };
  const year = Math.floor(proposed);
  if (!Number.isFinite(year) || year < 1000 || year > 2999) return { year: null, reason: "not a plausible year" };
  const found = new Set((body.match(/\b(1[0-9]{3}|2[0-9]{3})\b/g) ?? []).map(Number));
  if (!found.has(year)) {
    return { year: null, reason: "the entry does not name this year" };
  }
  return { year };
}

/**
 * A model asked for null sometimes writes the word instead. Treating those as
 * absent keeps the "discarded proposals" list meaningful: it should only ever
 * show real overreach, not "the word none is not a known category".
 */
const SENTINELS = new Set(["", "none", "null", "nil", "n/a", "na", "unknown", "no title", "undefined"]);

function absent(value: string | null | undefined): boolean {
  return value == null || SENTINELS.has(value.trim().toLowerCase());
}

function normalise(raw: {
  title?: string | null;
  kind?: string | null;
  clusterId?: string | null;
  whenHappened?: number | null;
}): { title: string | null; kind: string | null; clusterId: string | null; whenHappened: number | null } {
  return {
    title: absent(raw.title) ? null : raw.title!.trim(),
    kind: absent(raw.kind) ? null : raw.kind!.trim().toLowerCase(),
    clusterId: absent(raw.clusterId) ? null : raw.clusterId!.trim(),
    whenHappened: raw.whenHappened == null || raw.whenHappened === 0 ? null : raw.whenHappened,
  };
}

export function validateProposal(
  entry: EntryDoc,
  raw: { title?: string | null; kind?: string | null; clusterId?: string | null; whenHappened?: number | null },
  clusterIds: Set<string>,
): { proposal: Proposal; rejected: Rejection[] } {
  const rejected: Rejection[] = [];
  const proposal: Proposal = { entryId: entry._id, title: null, kind: null, clusterId: null, whenHappened: null };

  if (raw.title) {
    const verdict = verbatimTitle(entry.body, raw.title);
    if ("title" in verdict) proposal.title = verdict.title;
    else rejected.push({ entryId: entry._id, field: "title", proposed: collapse(raw.title), reason: verdict.reason });
  }

  if (raw.kind) {
    if (isKind(raw.kind)) proposal.kind = raw.kind;
    else rejected.push({ entryId: entry._id, field: "kind", proposed: String(raw.kind), reason: "not a known category" });
  }

  if (raw.clusterId) {
    if (clusterIds.has(raw.clusterId)) proposal.clusterId = raw.clusterId;
    else
      rejected.push({
        entryId: entry._id,
        field: "cluster",
        proposed: String(raw.clusterId),
        reason: "not an existing cluster",
      });
  }

  const year = verbatimYear(entry.body, raw.whenHappened ?? null);
  proposal.whenHappened = year.year;
  if (year.reason && raw.whenHappened != null) {
    rejected.push({
      entryId: entry._id,
      field: "whenHappened",
      proposed: String(raw.whenHappened),
      reason: year.reason,
    });
  }

  return { proposal, rejected };
}

// --- the prompt ------------------------------------------------------------

export const SUGGEST_SYSTEM = `You are helping someone file their own personal archive. The archive will be read by their family after they die.

You are naming and filing. You are NOT interpreting, concluding, diagnosing, or explaining.

Rules for a title:
- Lift a phrase VERBATIM from the entry. Copy the author's exact words, character for character. Do not paraphrase, tidy, re-punctuate or reorder.
- Prefer the phrase that a reader would recognise as what this entry is about, usually from the opening sentence.
- Never add a judgement, a conclusion, or an emotion the text does not state.
- Never assign blame and never name a culprit, even if the entry implies one.
- Never generalise a single moment into a pattern ("sometimes" must not become "always", one argument must not become a relationship).
- Do not drop a negation that changes the meaning of the phrase you lift.
- If no phrase in the entry works as a title, return null. A null title is a good outcome and is expected often.

Rules for a category: one of ${KINDS.join(", ")}. Return null if none clearly fits. Do not force a fit.

Rules for a cluster: choose only from the cluster list given. Return null if none clearly fits, or if there are no clusters.

Rules for the year: only if the entry names a year or clearly implies a specific one. The year must be a number written in the entry. Otherwise null.

Worked example of the mistake to avoid:
  Entry: "I sometimes feel invisible at home."
  WRONG: "My Family Never Understood Me" - this interprets, blames, generalises, and would misrepresent the author to a grieving reader forever.
  RIGHT: "I sometimes feel invisible at home" - or null.

Return one object per entry, in the order given, using the entry ids provided.`;

const ProposalSchema = z.object({
  proposals: z.array(
    z.object({
      entryId: z.string(),
      title: z.string().nullable(),
      kind: z.enum(KINDS).nullable(),
      clusterId: z.string().nullable(),
      whenHappened: z.number().int().nullable(),
    }),
  ),
});

function buildUserMessage(entries: EntryDoc[], clusters: ClusterDoc[]): string {
  const clusterList = clusters.length
    ? clusters.map((c) => `  - id: ${c._id} | name: ${c.name}`).join("\n")
    : "  (none yet - return null for clusterId)";
  const entryBlocks = entries
    .map((e) => `<entry id="${e._id}">\n${e.body}\n</entry>`)
    .join("\n\n");
  return `Clusters available:\n${clusterList}\n\nEntries to name and file:\n\n${entryBlocks}`;
}

/** The no-model path: the opening clause of the entry, verbatim. */
export function extractiveProposal(entry: EntryDoc): { title: string | null; whenHappened: number | null } {
  const flat = collapse(entry.body);
  if (!flat) return { title: null, whenHappened: null };
  // First sentence or clause, cut at a boundary the author themselves wrote.
  const match = flat.match(/^[^.!?\n]{1,120}/);
  let candidate = match ? match[0] : flat.slice(0, 120);
  if (candidate.length > MAX_TITLE) {
    const window = candidate.slice(0, MAX_TITLE);
    const lastComma = Math.max(window.lastIndexOf(","), window.lastIndexOf(";"), window.lastIndexOf(" - "));
    const lastSpace = window.lastIndexOf(" ");
    const cut = lastComma > MIN_TITLE ? lastComma : lastSpace;
    candidate = cut > MIN_TITLE ? window.slice(0, cut) : window;
  }
  const verdict = verbatimTitle(entry.body, candidate);
  const years = (entry.body.match(/\b(1[0-9]{3}|2[0-9]{3})\b/g) ?? []).map(Number);
  return {
    title: "title" in verdict ? verdict.title : null,
    // Only when the entry names exactly one year is there no ambiguity.
    whenHappened: new Set(years).size === 1 ? years[0] : null,
  };
}

export async function suggestForEntries(entryIds: string[]): Promise<SuggestResult> {
  const store = await getStore();
  const [entries, clusters] = await Promise.all([
    store.entries.find({ _id: { $in: entryIds }, deletedAt: null }, { projection: { embedding: 0 } }),
    store.clusters.find({}, { sort: { order: 1 } }),
  ]);
  const clusterIds = new Set(clusters.map((c) => c._id));
  const result: SuggestResult = { proposals: [], rejected: [], engine: "extractive", notes: [] };
  if (entries.length === 0) return result;

  if (!env.openaiKey) {
    for (const entry of entries) {
      const { title, whenHappened } = extractiveProposal(entry);
      const { proposal, rejected } = validateProposal(
        entry,
        { title, kind: null, clusterId: null, whenHappened },
        clusterIds,
      );
      result.proposals.push(proposal);
      result.rejected.push(...rejected);
    }
    result.notes.push(
      "No model configured, so these titles are the opening words of each entry, lifted verbatim. Categories and clusters were left empty rather than guessed.",
    );
    return result;
  }

  result.engine = "model";
  const client = new OpenAI({ apiKey: env.openaiKey, timeout: 120_000, maxRetries: 2 });

  try {
    // Structured outputs, so the shape of the reply is guaranteed and the
    // guardrails below are the only thing deciding what reaches the author.
    const response = await client.responses.parse({
      model: env.suggestModel,
      instructions: SUGGEST_SYSTEM,
      input: buildUserMessage(entries, clusters),
      max_output_tokens: 16000,
      text: { format: zodTextFormat(ProposalSchema, "proposals") },
    });

    // A refusal arrives as a content part rather than an error, so it has to
    // be looked for explicitly.
    let refusal: string | null = null;
    for (const item of response.output) {
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const part of content as { type?: string; refusal?: string }[]) {
        if (part.type === "refusal") refusal = part.refusal ?? "declined";
      }
    }

    if (refusal || response.status === "incomplete") {
      const why = refusal
        ? "The model declined to respond to this batch."
        : `The model's reply was cut off (${response.incomplete_details?.reason ?? "unknown reason"}).`;
      result.notes.push(
        `${why} Nothing was proposed; the entries are unchanged. You can title them yourself, or leave them as they are.`,
      );
      for (const entry of entries) {
        result.proposals.push({ entryId: entry._id, title: null, kind: null, clusterId: null, whenHappened: null });
      }
      return result;
    }

    const parsed = response.output_parsed;
    const byId = new Map(entries.map((e) => [e._id, e]));
    const seen = new Set<string>();

    for (const raw of parsed?.proposals ?? []) {
      const entry = byId.get(raw.entryId);
      if (!entry || seen.has(raw.entryId)) continue;
      seen.add(raw.entryId);
      const { proposal, rejected } = validateProposal(entry, normalise(raw), clusterIds);
      result.proposals.push(proposal);
      result.rejected.push(...rejected);
    }
    // Any entry the model skipped gets an explicit "leave it alone" proposal.
    for (const entry of entries) {
      if (!seen.has(entry._id)) {
        result.proposals.push({ entryId: entry._id, title: null, kind: null, clusterId: null, whenHappened: null });
      }
    }
    return result;
  } catch (err) {
    // A suggestion pass is a convenience. If it cannot run, the archive is
    // entirely unaffected and the author can file by hand.
    //
    // The two failures are worth telling apart on screen: an unreachable
    // service is something to retry, a reply that does not fit the schema is
    // not - and calling the second one "could not be reached" would send the
    // author looking for a network problem that isn't there.
    // Schema validation errors arrive as a page of JSON. The author needs to
    // know it failed and roughly why, not to read a validator's output.
    const full = (err as Error).message;
    const message = full.replace(/\s+/g, " ").trim().slice(0, 180) + (full.length > 180 ? "…" : "");
    const unreachable =
      err instanceof OpenAI.APIError || /fetch failed|network|timeout|ECONN|ENOTFOUND|aborted/i.test(full);
    result.engine = "extractive";
    result.notes.push(
      unreachable
        ? `The suggestion model could not be reached (${message}). These titles are the opening words of each entry, lifted verbatim.`
        : `The model replied with something this app could not read, so none of it was used (${message}). These titles are the opening words of each entry, lifted verbatim.`,
    );
    for (const entry of entries) {
      const { title, whenHappened } = extractiveProposal(entry);
      const { proposal, rejected } = validateProposal(entry, { title, whenHappened }, clusterIds);
      result.proposals.push(proposal);
      result.rejected.push(...rejected);
    }
    return result;
  }
}

/** The batch the naming screen offers next: unfiled or untitled, oldest first. */
export async function nextSuggestionBatch(size = 12): Promise<EntryDoc[]> {
  const store = await getStore();
  return store.entries.find(
    { deletedAt: null, $or: [{ title: "" }, { clusterId: null }] },
    { sort: { whenWritten: 1 }, limit: Math.min(Math.max(size, 1), 20), projection: { embedding: 0 } },
  );
}

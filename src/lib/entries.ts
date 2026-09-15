import { getStore } from "./store";
import type { Filter } from "./store/query";
import { newId } from "./ids";
import { isKind, type EntryDoc, type Kind, type RelatedBasis } from "./types";
import { queueEmbedding } from "./embedding";
import { noteWrite } from "./recent-writes";

/**
 * Every write to `entries` goes through here.
 *
 * Two invariants this module exists to protect:
 *   1. `body` is only ever set from author input. No automated path in this
 *      codebase edits, rewrites, summarises or normalises it - not the
 *      suggestion pass, not the rethread job, not the exporter.
 *   2. `whenWritten` is set once, at capture, and can never be patched.
 */

export const NOT_DELETED: Filter = { deletedAt: null };

export interface CaptureInput {
  body: string;
  private?: boolean;
  /** Optional from the start: nothing here is required to save. */
  title?: string;
  kind?: Kind;
  clusterId?: string | null;
  attribution?: string;
  whenHappened?: number | null;
  /** Client-generated id, so an offline capture keeps its identity on sync. */
  id?: string;
  /** Client capture time for offline entries; ignored if absent or invalid. */
  capturedAt?: string;
  /** Client edit time, used to resolve sync conflicts by last write wins. */
  updatedAt?: string;
}

function cleanYear(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const y = Math.floor(n);
  return y >= 1 && y <= 9999 ? y : null;
}

export function newEntryDoc(input: CaptureInput): EntryDoc {
  const now = new Date();
  const captured = input.capturedAt ? new Date(input.capturedAt) : now;
  const whenWritten = Number.isNaN(captured.getTime()) ? now : captured;
  const edited = input.updatedAt ? new Date(input.updatedAt) : whenWritten;
  const updatedAt = Number.isNaN(edited.getTime()) ? now : edited;
  const title = (input.title ?? "").trim();
  return {
    _id: input.id && /^[0-9a-fA-F]{24}$/.test(input.id) ? input.id : newId(),
    body: input.body,
    title,
    titleSource: title ? "author" : "",
    kind: isKind(input.kind) ? input.kind : "thought",
    kindSource: isKind(input.kind) ? "author" : "suggested",
    clusterId: input.clusterId ?? null,
    clusterSource: input.clusterId ? "author" : "suggested",
    attribution: (input.attribution ?? "").trim(),
    whenHappened: cleanYear(input.whenHappened),
    whenWritten,
    reflections: [],
    private: !!input.private,
    related: [],
    position: { x: 0, y: 0, pinned: false },
    createdAt: whenWritten,
    updatedAt,
    deletedAt: null,
  };
}

/**
 * Capture. The body is stored as given; everything else may stay empty
 * forever. The embedding is computed after this returns and never blocks it.
 */
export async function captureEntry(input: CaptureInput): Promise<EntryDoc> {
  if (typeof input.body !== "string" || input.body.trim() === "") {
    throw new HttpError(400, "body is required");
  }
  const store = await getStore();
  const doc = newEntryDoc(input);

  const existing = await store.entries.findOne({ _id: doc._id }, { projection: { embedding: 0 } });
  if (existing) {
    // A re-sync of an entry the server already has (the offline queue retried,
    // or two devices held the same draft). Resolved per entry, last write
    // wins, and only over the fields the capture screen can produce.
    if (new Date(existing.updatedAt).getTime() >= new Date(doc.updatedAt).getTime()) return existing;
    const updated = await store.entries.updateOne(
      { _id: doc._id },
      { $set: { body: doc.body, private: doc.private, updatedAt: doc.updatedAt } },
    );
    if (updated && updated.body !== existing.body) queueEmbedding(doc._id, updated.body);
    noteWrite();
    return updated ?? existing;
  }

  const saved = await store.entries.insert(doc);
  noteWrite();
  queueEmbedding(saved._id, saved.body);
  return saved;
}

/** The optional "split on blank lines" checkbox. Default off, deliberately. */
export function splitOnBlankLines(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface EntryPatch {
  title?: string;
  kind?: Kind;
  clusterId?: string | null;
  attribution?: string;
  whenHappened?: number | null;
  private?: boolean;
  body?: string;
  position?: { x: number; y: number; pinned?: boolean };
  /** Who is making this change. The naming pass sends "suggested". */
  source?: "author" | "suggested";
}

const FORBIDDEN_PATCH_FIELDS = ["whenWritten", "createdAt", "reflections", "embedding", "related", "_id"];

/**
 * Edit. Rejects any attempt to change `whenWritten` - the capture time is a
 * fact about the archive, not a preference.
 *
 * `body` may be changed here, but only by the author: `source` must be
 * "author" (the default), and no automated caller in this codebase passes a
 * body at all.
 */
export async function patchEntry(id: string, patch: EntryPatch): Promise<EntryDoc> {
  for (const field of FORBIDDEN_PATCH_FIELDS) {
    if (field in (patch as Record<string, unknown>)) {
      throw new HttpError(400, `${field} cannot be changed through this endpoint`);
    }
  }
  const source = patch.source === "suggested" ? "suggested" : "author";
  const store = await getStore();
  const current = await store.entries.findOne({ _id: id }, { projection: { embedding: 0 } });
  if (!current || current.deletedAt) throw new HttpError(404, "entry not found");

  const $set: Record<string, unknown> = { updatedAt: new Date() };

  if (patch.title !== undefined) {
    const t = String(patch.title).trim();
    $set.title = t;
    // Clearing a title returns the entry to "show the opening words", which
    // is how a suggested title is reverted without touching the body.
    $set.titleSource = t ? source : "";
  }
  if (patch.kind !== undefined) {
    if (!isKind(patch.kind)) throw new HttpError(400, "unknown kind");
    $set.kind = patch.kind;
    $set.kindSource = source;
  }
  if (patch.clusterId !== undefined) {
    const cid = patch.clusterId;
    if (cid !== null) {
      const cluster = await store.clusters.findOne({ _id: cid });
      if (!cluster) throw new HttpError(400, "unknown cluster");
    }
    $set.clusterId = cid;
    $set.clusterSource = source;
  }
  if (patch.attribution !== undefined) $set.attribution = String(patch.attribution).trim();
  if (patch.whenHappened !== undefined) $set.whenHappened = cleanYear(patch.whenHappened);
  if (patch.private !== undefined) $set.private = !!patch.private;
  if (patch.body !== undefined) {
    if (source !== "author") throw new HttpError(403, "only the author may change the body of an entry");
    if (typeof patch.body !== "string" || patch.body.trim() === "") throw new HttpError(400, "body cannot be emptied");
    $set.body = patch.body;
  }
  if (patch.position !== undefined) {
    const p = patch.position;
    $set.position = {
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      pinned: p.pinned === undefined ? true : !!p.pinned,
    };
  }

  const updated = await store.entries.updateOne({ _id: id }, { $set });
  if (!updated) throw new HttpError(404, "entry not found");
  noteWrite();
  if (patch.body !== undefined) queueEmbedding(id, patch.body);
  return updated;
}

/** Reflections are appended. They never replace or alter the body. */
export async function addReflection(id: string, text: string, at?: string): Promise<EntryDoc> {
  if (typeof text !== "string" || text.trim() === "") throw new HttpError(400, "text is required");
  const store = await getStore();
  const when = at ? new Date(at) : new Date();
  const updated = await store.entries.updateOne(
    { _id: id, deletedAt: null },
    {
      $push: { reflections: { at: Number.isNaN(when.getTime()) ? new Date() : when, text } },
      $set: { updatedAt: new Date() },
    },
  );
  if (!updated) throw new HttpError(404, "entry not found");
  noteWrite();
  return updated;
}

/** Soft delete. This is an archive; nothing is ever actually removed. */
export async function softDeleteEntry(id: string): Promise<void> {
  const store = await getStore();
  const updated = await store.entries.updateOne(
    { _id: id, deletedAt: null },
    { $set: { deletedAt: new Date(), updatedAt: new Date() } },
  );
  if (!updated) throw new HttpError(404, "entry not found");
  // A deleted entry must stop appearing in results straight away, which the
  // index will not reflect for a moment either.
  noteWrite();
}

export async function restoreEntry(id: string): Promise<EntryDoc> {
  const store = await getStore();
  const updated = await store.entries.updateOne({ _id: id }, { $set: { deletedAt: null, updatedAt: new Date() } });
  if (!updated) throw new HttpError(404, "entry not found");
  return updated;
}

export interface ListQuery {
  cluster?: string | null;
  /** "unfiled" selects entries with no cluster, a valid resting state. */
  unfiled?: boolean;
  untitled?: boolean;
  year?: number;
  /** Which year field to filter on. Default: when it happened, falling back to written. */
  yearField?: "happened" | "written";
  private?: boolean;
  kind?: Kind;
  includePrivate?: boolean;
  includeDeleted?: boolean;
  limit?: number;
  skip?: number;
  sort?: "written-desc" | "written-asc" | "happened-asc" | "happened-desc";
}

export function buildListFilter(q: ListQuery): Filter {
  const filter: Filter = {};
  if (!q.includeDeleted) filter.deletedAt = null;
  if (q.includePrivate === false) filter.private = false;
  if (q.private !== undefined) filter.private = q.private;
  if (q.unfiled) filter.clusterId = null;
  else if (q.cluster) filter.clusterId = q.cluster;
  if (q.untitled) filter.title = "";
  if (q.kind) filter.kind = q.kind;
  if (q.year !== undefined) {
    if (q.yearField === "written") {
      filter.whenWritten = {
        $gte: new Date(Date.UTC(q.year, 0, 1)),
        $lt: new Date(Date.UTC(q.year + 1, 0, 1)),
      };
    } else {
      filter.whenHappened = q.year;
    }
  }
  return filter;
}

const SORTS: Record<NonNullable<ListQuery["sort"]>, Record<string, 1 | -1>> = {
  "written-desc": { whenWritten: -1 },
  "written-asc": { whenWritten: 1 },
  "happened-asc": { whenHappened: 1, whenWritten: 1 },
  "happened-desc": { whenHappened: -1, whenWritten: -1 },
};

export async function listEntries(q: ListQuery): Promise<{ entries: EntryDoc[]; total: number }> {
  const store = await getStore();
  const filter = buildListFilter(q);
  const [entries, total] = await Promise.all([
    store.entries.find(filter, {
      sort: SORTS[q.sort ?? "written-desc"],
      limit: Math.min(q.limit ?? 100, 1000),
      skip: q.skip ?? 0,
      projection: { embedding: 0 },
    }),
    store.entries.count(filter),
  ]);
  return { entries, total };
}

export async function getEntry(id: string, opts: { includePrivate?: boolean } = {}): Promise<EntryDoc | null> {
  const store = await getStore();
  const filter: Filter = { _id: id, deletedAt: null };
  if (opts.includePrivate === false) filter.private = false;
  return store.entries.findOne(filter, { projection: { embedding: 0 } });
}

export async function getEntriesByIds(ids: string[]): Promise<EntryDoc[]> {
  if (ids.length === 0) return [];
  const store = await getStore();
  return store.entries.find({ _id: { $in: ids }, deletedAt: null }, { projection: { embedding: 0 }, limit: ids.length });
}

export interface Facets {
  total: number;
  privateCount: number;
  unfiled: number;
  untitled: number;
  clusters: Record<string, number>;
  /**
   * Entries *written* per calendar year. This counts writing, not
   * significance: pain generates writing and contentment often generates
   * none. The UI must say so.
   */
  writtenByYear: { year: number; count: number }[];
  /** Years the entries are *about*, where the author supplied one. */
  happenedByYear: { year: number; count: number }[];
}

export async function getFacets(opts: { includePrivate: boolean }): Promise<Facets> {
  const store = await getStore();
  const filter: Filter = { deletedAt: null };
  if (!opts.includePrivate) filter.private = false;

  const written = new Map<number, number>();
  const happened = new Map<number, number>();
  const clusters: Record<string, number> = {};
  let total = 0;
  let unfiled = 0;
  let untitled = 0;
  let privateCount = 0;

  await store.entries.eachBatch(
    filter,
    { projection: { embedding: 0 }, batchSize: 1000 },
    (batch) => {
      for (const e of batch) {
        total++;
        if (e.private) privateCount++;
        if (!e.clusterId) unfiled++;
        else clusters[e.clusterId] = (clusters[e.clusterId] ?? 0) + 1;
        if (!e.title) untitled++;
        const wy = new Date(e.whenWritten).getFullYear();
        written.set(wy, (written.get(wy) ?? 0) + 1);
        if (e.whenHappened) happened.set(e.whenHappened, (happened.get(e.whenHappened) ?? 0) + 1);
      }
    },
  );

  const toSorted = (m: Map<number, number>) =>
    [...m.entries()].map(([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year);

  return {
    total,
    privateCount,
    unfiled,
    untitled,
    clusters,
    writtenByYear: toSorted(written),
    happenedByYear: toSorted(happened),
  };
}

/** Author-made connections. They outrank anything the machine derived. */
export async function connectEntries(a: string, b: string): Promise<void> {
  if (a === b) throw new HttpError(400, "an entry cannot be connected to itself");
  const store = await getStore();
  const [ea, eb] = await Promise.all([store.entries.findOne({ _id: a }), store.entries.findOne({ _id: b })]);
  if (!ea || !eb) throw new HttpError(404, "entry not found");
  await Promise.all([link(a, b), link(b, a)]);

  async function link(from: string, to: string): Promise<void> {
    const store2 = await getStore();
    await store2.entries.update({ _id: from }, { $pull: { related: { entryId: to } } });
    await store2.entries.update(
      { _id: from },
      {
        $push: { related: { entryId: to, score: 1, basis: "author" as RelatedBasis } },
        $set: { updatedAt: new Date() },
      },
    );
  }
}

export async function disconnectEntries(a: string, b: string): Promise<void> {
  const store = await getStore();
  await store.entries.update({ _id: a }, { $pull: { related: { entryId: b } } });
  await store.entries.update({ _id: b }, { $pull: { related: { entryId: a } } });
}

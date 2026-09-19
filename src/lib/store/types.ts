import type { Filter, Sort, UpdateOps } from "./query";
import type { ArchiveDoc, ClusterDoc, EntryDoc, SettingsDoc } from "../types";

export interface FindOpts {
  sort?: Sort;
  limit?: number;
  skip?: number;
  projection?: Record<string, 0 | 1>;
}

export interface Collection<T extends { _id: string }> {
  find(filter?: Filter, opts?: FindOpts): Promise<T[]>;
  findOne(filter: Filter, opts?: FindOpts): Promise<T | null>;
  count(filter?: Filter): Promise<number>;
  insert(doc: T): Promise<T>;
  insertMany(docs: T[]): Promise<number>;
  /** updateMany semantics. Returns the number of documents changed. */
  update(filter: Filter, ops: UpdateOps): Promise<number>;
  /** Updates at most one document and returns it as it now stands. */
  updateOne(filter: Filter, ops: UpdateOps): Promise<T | null>;
  /** Hard delete. Entries are only ever soft-deleted; this is for clusters. */
  remove(filter: Filter): Promise<number>;
  /** Batched iteration, so a 5,000-entry rethread never holds every embedding at once. */
  eachBatch(
    filter: Filter,
    opts: FindOpts & { batchSize?: number },
    fn: (batch: T[]) => Promise<void> | void,
  ): Promise<void>;
}

export interface ScoredId {
  _id: string;
  score: number;
}

export interface Store {
  backend: "mongo" | "file";
  entries: Collection<EntryDoc>;
  clusters: Collection<ClusterDoc>;
  archive: Collection<ArchiveDoc>;
  /** Operational settings only. Never exported. */
  settings: Collection<SettingsDoc>;
  /** Atlas Search. null when no search index is configured -> caller falls back. */
  textSearch(
    q: string,
    opts: { limit: number; includePrivate: boolean },
  ): Promise<ScoredId[] | null>;
  /** Atlas Vector Search. null when unavailable -> caller falls back to TF-IDF. */
  vectorSearch(
    vector: number[],
    opts: { limit: number; excludeId?: string },
  ): Promise<ScoredId[] | null>;
  /**
   * Whether the text index is actually usable. Atlas answers a query against
   * a missing or still-building index with zero rows and no error, so an
   * empty result alone cannot be trusted - this is how the caller tells
   * "nothing matched" apart from "nothing could match".
   */
  searchIndexStatus(): Promise<"ready" | "missing" | "building" | "unknown">;
  ensureIndexes(): Promise<string[]>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export const DATE_PATHS: Record<string, string[]> = {
  entries: ["whenWritten", "createdAt", "updatedAt", "deletedAt", "reflections.at"],
  clusters: [],
  archive: ["updatedAt"],
  settings: ["updatedAt"],
};

/** Fields holding ids, for ObjectId conversion at the Mongo boundary. */
export const ID_PATHS: Record<string, string[]> = {
  entries: ["_id", "clusterId", "related.entryId"],
  clusters: ["_id"],
  archive: [],
  settings: [],
};

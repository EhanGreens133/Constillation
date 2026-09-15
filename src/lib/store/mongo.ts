import { MongoClient, ObjectId, type Db, type Document } from "mongodb";
import type { Filter, UpdateOps } from "./query";
import {
  ID_PATHS,
  type Collection as StoreCollection,
  type FindOpts,
  type ScoredId,
  type Store,
} from "./types";
import type { ArchiveDoc, ClusterDoc, EntryDoc } from "../types";
import { newId } from "../ids";
import { env } from "../env";

/**
 * MongoDB backend. Ids are ObjectIds in the database and hex strings
 * everywhere above this file, so the exported JSON has no BSON in it.
 */

const isHexId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);

const toOid = (v: any): any => (isHexId(v) ? new ObjectId(v) : v);
const fromOid = (v: any): any => (v instanceof ObjectId ? v.toHexString() : v);

/** Applies `fn` to every value at `path`, descending through arrays. */
function mapPath(node: any, segs: string[], i: number, fn: (v: any) => any): void {
  if (node == null || typeof node !== "object") return;
  const key = segs[i];
  if (i === segs.length - 1) {
    if (key in node) node[key] = fn(node[key]);
    return;
  }
  const next = node[key];
  if (Array.isArray(next)) for (const el of next) mapPath(el, segs, i + 1, fn);
  else mapPath(next, segs, i + 1, fn);
}

function convertDoc<T>(doc: any, paths: string[], fn: (v: any) => any): T {
  if (doc == null) return doc;
  for (const p of paths) {
    const segs = p.split(".");
    if (Array.isArray(doc)) for (const el of doc) mapPath(el, segs, 0, fn);
    else mapPath(doc, segs, 0, fn);
  }
  return doc as T;
}

function convertValue(v: any, fn: (x: any) => any): any {
  if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
    const keys = Object.keys(v);
    if (keys.some((k) => k.startsWith("$"))) {
      const out: any = {};
      for (const k of keys) {
        out[k] = Array.isArray(v[k]) ? v[k].map(fn) : k === "$exists" ? v[k] : fn(v[k]);
      }
      return out;
    }
  }
  return Array.isArray(v) ? v.map(fn) : fn(v);
}

function convertFilter(filter: Filter, paths: string[], fn: (v: any) => any): Filter {
  const out: Filter = {};
  for (const [k, v] of Object.entries(filter ?? {})) {
    if (k === "$or" || k === "$and" || k === "$nor") {
      out[k] = (v as Filter[]).map((f) => convertFilter(f, paths, fn));
    } else if (paths.includes(k)) {
      out[k] = convertValue(v, fn);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function convertOps(ops: UpdateOps, paths: string[]): UpdateOps {
  const out: any = {};
  for (const [op, payload] of Object.entries(ops)) {
    const conv: any = {};
    for (const [field, value] of Object.entries(payload as Record<string, any>)) {
      if (paths.includes(field)) {
        conv[field] = convertValue(value, toOid);
      } else if (paths.some((p) => p.startsWith(`${field}.`)) || field === "related") {
        // e.g. $push: { related: { entryId: "<hex>" } }
        conv[field] = convertDoc(structuredClone(value), ["entryId", "$each.entryId"], toOid);
      } else {
        conv[field] = value;
      }
    }
    out[op] = conv;
  }
  return out;
}

class MongoCollection<T extends { _id: string }> implements StoreCollection<T> {
  constructor(
    private readonly db: Db,
    private readonly name: string,
  ) {}

  private get col() {
    return this.db.collection<Document>(this.name);
  }

  private get idPaths(): string[] {
    return ID_PATHS[this.name] ?? ["_id"];
  }

  private out(doc: any): T {
    return convertDoc<T>(doc, this.idPaths, fromOid);
  }

  async find(filter: Filter = {}, opts: FindOpts = {}): Promise<T[]> {
    let cursor = this.col.find(convertFilter(filter, this.idPaths, toOid) as any);
    if (opts.projection) cursor = cursor.project(opts.projection) as any;
    if (opts.sort) cursor = cursor.sort(opts.sort as any);
    if (opts.skip) cursor = cursor.skip(opts.skip);
    if (opts.limit != null) cursor = cursor.limit(opts.limit);
    const docs = await cursor.toArray();
    return docs.map((d) => this.out(d));
  }

  async findOne(filter: Filter, opts: FindOpts = {}): Promise<T | null> {
    const [doc] = await this.find(filter, { ...opts, limit: 1 });
    return doc ?? null;
  }

  async count(filter: Filter = {}): Promise<number> {
    return this.col.countDocuments(convertFilter(filter, this.idPaths, toOid) as any);
  }

  async insert(doc: T): Promise<T> {
    const prepared: any = structuredClone(doc);
    if (!prepared._id) prepared._id = newId();
    await this.col.insertOne(convertDoc(prepared, this.idPaths, toOid) as any);
    return this.out(prepared);
  }

  async insertMany(docs: T[]): Promise<number> {
    if (docs.length === 0) return 0;
    const prepared = docs.map((d) => {
      const p: any = structuredClone(d);
      if (!p._id) p._id = newId();
      return convertDoc(p, this.idPaths, toOid);
    });
    const res = await this.col.insertMany(prepared as any[], { ordered: false });
    return res.insertedCount;
  }

  async update(filter: Filter, ops: UpdateOps): Promise<number> {
    const res = await this.col.updateMany(
      convertFilter(filter, this.idPaths, toOid) as any,
      convertOps(ops, this.idPaths) as any,
    );
    return res.modifiedCount;
  }

  async updateOne(filter: Filter, ops: UpdateOps): Promise<T | null> {
    const doc = await this.col.findOneAndUpdate(
      convertFilter(filter, this.idPaths, toOid) as any,
      convertOps(ops, this.idPaths) as any,
      { returnDocument: "after" },
    );
    return doc ? this.out(doc) : null;
  }

  async remove(filter: Filter): Promise<number> {
    const res = await this.col.deleteMany(convertFilter(filter, this.idPaths, toOid) as any);
    return res.deletedCount;
  }

  async eachBatch(
    filter: Filter,
    opts: FindOpts & { batchSize?: number },
    fn: (batch: T[]) => Promise<void> | void,
  ): Promise<void> {
    const size = opts.batchSize ?? 500;
    let cursor = this.col.find(convertFilter(filter, this.idPaths, toOid) as any).batchSize(size);
    if (opts.projection) cursor = cursor.project(opts.projection) as any;
    if (opts.sort) cursor = cursor.sort(opts.sort as any);
    let batch: T[] = [];
    for await (const doc of cursor) {
      batch.push(this.out(doc));
      if (batch.length >= size) {
        await fn(batch);
        batch = [];
      }
    }
    if (batch.length) await fn(batch);
  }
}

export async function createMongoStore(uri: string, dbName: string): Promise<Store> {
  const client = new MongoClient(uri, { retryWrites: true });
  await client.connect();
  const db = client.db(dbName);

  const entries = new MongoCollection<EntryDoc>(db, "entries");
  const clusters = new MongoCollection<ClusterDoc>(db, "clusters");
  const archive = new MongoCollection<ArchiveDoc>(db, "archive");

  // Once a search feature has failed we stop asking for it: a missing Atlas
  // index is a permanent condition for this process, not a transient error.
  let textOk = !!env.atlasSearchIndex;
  let vectorOk = !!env.atlasVectorIndex;
  let indexStatus: { value: "ready" | "missing" | "building" | "unknown"; at: number } | null = null;

  return {
    backend: "mongo",
    entries,
    clusters,
    archive,

    async textSearch(q, opts): Promise<ScoredId[] | null> {
      if (!textOk) return null;
      try {
        const match: Document = { deletedAt: null };
        if (!opts.includePrivate) match.private = false;
        const rows = await db
          .collection("entries")
          .aggregate([
            {
              $search: {
                index: env.atlasSearchIndex,
                compound: {
                  should: [
                    { text: { query: q, path: "title", score: { boost: { value: 3 } } } },
                    { text: { query: q, path: "attribution", score: { boost: { value: 2 } } } },
                    { text: { query: q, path: "body", fuzzy: { maxEdits: 1 } } },
                    { phrase: { query: q, path: "body", score: { boost: { value: 2 } } } },
                  ],
                  minimumShouldMatch: 1,
                },
              },
            },
            { $match: match },
            { $limit: opts.limit },
            { $project: { _id: 1, score: { $meta: "searchScore" } } },
          ])
          .toArray();
        return rows.map((r) => ({ _id: fromOid(r._id), score: r.score as number }));
      } catch (err) {
        textOk = false;
        console.warn("[store] Atlas Search unavailable, falling back to lexical scan:", (err as Error).message);
        return null;
      }
    },

    async vectorSearch(vector, opts): Promise<ScoredId[] | null> {
      if (!vectorOk || vector.length === 0) return null;
      try {
        const rows = await db
          .collection("entries")
          .aggregate([
            {
              $vectorSearch: {
                index: env.atlasVectorIndex,
                path: "embedding",
                queryVector: vector,
                numCandidates: Math.max(100, opts.limit * 15),
                limit: opts.limit + 1,
                filter: { deletedAt: null },
              },
            },
            { $project: { _id: 1, score: { $meta: "vectorSearchScore" } } },
          ])
          .toArray();
        return rows
          .map((r) => ({ _id: fromOid(r._id), score: r.score as number }))
          .filter((r) => r._id !== opts.excludeId)
          .slice(0, opts.limit);
      } catch (err) {
        vectorOk = false;
        console.warn("[store] Atlas Vector Search unavailable, falling back to TF-IDF:", (err as Error).message);
        return null;
      }
    },

    async searchIndexStatus(): Promise<"ready" | "missing" | "building" | "unknown"> {
      if (!env.atlasSearchIndex) return "missing";
      const now = Date.now();
      // Cached briefly rather than permanently: an index created or finished
      // building while the server is up should start being used on its own.
      if (indexStatus && now - indexStatus.at < 60_000) return indexStatus.value;
      let value: "ready" | "missing" | "building" | "unknown" = "unknown";
      try {
        const found = await db
          .collection("entries")
          .listSearchIndexes(env.atlasSearchIndex)
          .toArray();
        if (found.length === 0) value = "missing";
        else value = (found[0] as { status?: string }).status === "READY" ? "ready" : "building";
      } catch {
        // Not Atlas, or the command is unavailable. Either way we cannot know.
        value = "unknown";
      }
      indexStatus = { value, at: now };
      return value;
    },

    async ensureIndexes(): Promise<string[]> {
      const created: string[] = [];
      const col = db.collection("entries");
      created.push(await col.createIndex({ clusterId: 1, whenHappened: 1 }, { name: "cluster_when" }));
      created.push(await col.createIndex({ private: 1 }, { name: "private" }));
      created.push(await col.createIndex({ deletedAt: 1 }, { name: "deleted" }));
      created.push(await col.createIndex({ whenWritten: -1 }, { name: "when_written" }));
      created.push(await col.createIndex({ "related.entryId": 1 }, { name: "related_entry" }));
      created.push(await db.collection("clusters").createIndex({ order: 1 }, { name: "order" }));

      // Atlas-only search indexes. On a plain mongod these commands do not
      // exist; that is not an error, it just means the fallbacks stay in use.
      const searchIndexes = [
        {
          name: env.atlasSearchIndex || "entries_text",
          definition: {
            mappings: {
              dynamic: false,
              fields: {
                body: { type: "string" },
                title: { type: "string" },
                attribution: { type: "string" },
                private: { type: "boolean" },
                deletedAt: { type: "date" },
              },
            },
          },
        },
        {
          name: env.atlasVectorIndex || "entries_vector",
          type: "vectorSearch",
          definition: {
            fields: [
              {
                type: "vector",
                path: "embedding",
                numDimensions: env.embeddingDimensions,
                similarity: "cosine",
              },
              { type: "filter", path: "deletedAt" },
              { type: "filter", path: "private" },
            ],
          },
        },
      ];
      for (const spec of searchIndexes) {
        try {
          await col.createSearchIndex(spec as any);
          created.push(`search index ${spec.name}`);
        } catch (err) {
          created.push(`search index ${spec.name}: skipped (${(err as Error).message})`);
        }
      }
      return created;
    },

    async flush(): Promise<void> {
      /* writes are already durable */
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

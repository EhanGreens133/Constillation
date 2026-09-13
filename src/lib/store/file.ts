import fs from "node:fs";
import path from "node:path";
import { applyUpdate, matches, project, sortDocs, type Filter, type UpdateOps } from "./query";
import { DATE_PATHS, type Collection, type FindOpts, type ScoredId, type Store } from "./types";
import type { ArchiveDoc, ClusterDoc, EntryDoc } from "../types";
import { newId } from "../ids";

/**
 * A JSON-file backend so Constellation runs with no database at all: clone,
 * `npm run dev`, start writing. Single process only. It exists because the
 * author should never be blocked from capture by infrastructure, and because
 * the acceptance tests must run on a machine with no network.
 *
 * Atlas Search and Vector Search are reported unavailable here, which pushes
 * callers onto the lexical/TF-IDF paths - the same paths that run when Atlas
 * is configured but unreachable.
 */

function reviveDates(doc: any, paths: string[]): any {
  for (const p of paths) {
    const segs = p.split(".");
    const walk = (node: any, i: number): void => {
      if (node == null) return;
      const key = segs[i];
      if (i === segs.length - 1) {
        const v = node[key];
        if (typeof v === "string") node[key] = new Date(v);
        return;
      }
      const next = node[key];
      if (Array.isArray(next)) for (const el of next) walk(el, i + 1);
      else walk(next, i + 1);
    };
    if (Array.isArray(doc)) for (const el of doc) walk(el, 0);
    else walk(doc, 0);
  }
  return doc;
}

class FileCollection<T extends { _id: string }> implements Collection<T> {
  private docs: T[] = [];
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly datePaths: string[],
  ) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      this.docs = Array.isArray(parsed) ? reviveDates(parsed, datePaths) : [];
    } catch {
      this.docs = [];
    }
  }

  private schedule(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persist();
    }, 40);
  }

  private persist(): Promise<void> {
    if (!this.dirty) return this.writing;
    this.dirty = false;
    const snapshot = JSON.stringify(this.docs);
    this.writing = this.writing.then(async () => {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, snapshot, "utf8");
      await fs.promises.rename(tmp, this.file);
    });
    return this.writing;
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.persist();
    await this.writing;
  }

  private clone(doc: T, projection?: Record<string, 0 | 1>): T {
    return project(structuredClone(doc), projection);
  }

  async find(filter: Filter = {}, opts: FindOpts = {}): Promise<T[]> {
    let out = this.docs.filter((d) => matches(d, filter));
    out = sortDocs(out, opts.sort);
    if (opts.skip) out = out.slice(opts.skip);
    if (opts.limit != null) out = out.slice(0, opts.limit);
    return out.map((d) => this.clone(d, opts.projection));
  }

  async findOne(filter: Filter, opts: FindOpts = {}): Promise<T | null> {
    const [doc] = await this.find(filter, { ...opts, limit: 1 });
    return doc ?? null;
  }

  async count(filter: Filter = {}): Promise<number> {
    return this.docs.reduce((n, d) => (matches(d, filter) ? n + 1 : n), 0);
  }

  async insert(doc: T): Promise<T> {
    const stored = structuredClone(doc);
    if (!stored._id) (stored as any)._id = newId();
    this.docs.push(stored);
    this.schedule();
    return structuredClone(stored);
  }

  async insertMany(docs: T[]): Promise<number> {
    for (const d of docs) {
      const stored = structuredClone(d);
      if (!stored._id) (stored as any)._id = newId();
      this.docs.push(stored);
    }
    this.schedule();
    return docs.length;
  }

  async update(filter: Filter, ops: UpdateOps): Promise<number> {
    let n = 0;
    for (const doc of this.docs) {
      if (matches(doc, filter)) {
        applyUpdate(doc, ops);
        n++;
      }
    }
    if (n) this.schedule();
    return n;
  }

  async updateOne(filter: Filter, ops: UpdateOps): Promise<T | null> {
    for (const doc of this.docs) {
      if (matches(doc, filter)) {
        applyUpdate(doc, ops);
        this.schedule();
        return structuredClone(doc);
      }
    }
    return null;
  }

  async remove(filter: Filter): Promise<number> {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matches(d, filter));
    const removed = before - this.docs.length;
    if (removed) this.schedule();
    return removed;
  }

  async eachBatch(
    filter: Filter,
    opts: FindOpts & { batchSize?: number },
    fn: (batch: T[]) => Promise<void> | void,
  ): Promise<void> {
    const size = opts.batchSize ?? 500;
    const all = this.docs.filter((d) => matches(d, filter));
    const sorted = sortDocs(all, opts.sort);
    for (let i = 0; i < sorted.length; i += size) {
      await fn(sorted.slice(i, i + size).map((d) => this.clone(d, opts.projection)));
    }
  }
}

export function createFileStore(dir: string): Store {
  const entries = new FileCollection<EntryDoc>(path.join(dir, "entries.json"), DATE_PATHS.entries);
  const clusters = new FileCollection<ClusterDoc>(path.join(dir, "clusters.json"), DATE_PATHS.clusters);
  const archive = new FileCollection<ArchiveDoc>(path.join(dir, "archive.json"), DATE_PATHS.archive);

  return {
    backend: "file",
    entries,
    clusters,
    archive,
    async textSearch(): Promise<ScoredId[] | null> {
      return null; // no Atlas Search here; caller uses the lexical scan
    },
    async vectorSearch(): Promise<ScoredId[] | null> {
      return null; // no Atlas Vector Search here; caller brute-forces or uses TF-IDF
    },
    async ensureIndexes(): Promise<string[]> {
      return ["file backend: no indexes to create"];
    },
    async flush(): Promise<void> {
      await Promise.all([entries.flush(), clusters.flush(), archive.flush()]);
    },
    async close(): Promise<void> {
      await this.flush();
    },
  };
}

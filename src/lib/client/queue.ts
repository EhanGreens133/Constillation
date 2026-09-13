"use client";

/**
 * Offline capture queue.
 *
 * Capture must never fail and never lose anything, connectivity or not, so
 * every entry is written to IndexedDB first and only then pushed to the
 * server. A capture is "saved" the moment it is in IndexedDB; sync is a
 * background detail the author does not have to think about.
 *
 * Conflicts resolve per entry by last write wins, using the timestamps the
 * client recorded at capture time.
 */

export interface QueuedEntry {
  id: string;
  body: string;
  private: boolean;
  capturedAt: string;
  updatedAt: string;
  /** Splitting is decided on the client so the queued item is final. */
  status: "pending" | "synced";
  attempts: number;
  lastError?: string;
}

const DB_NAME = "constellation";
const DB_VERSION = 1;
const STORE = "outbox";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("status", "status");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = fn(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      }),
  );
}

/** 24 hex chars, so an offline entry keeps its identity once it syncs. */
export function newClientId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  // Leading 4 bytes as a timestamp keeps ids roughly ordered, like the server's.
  const seconds = Math.floor(Date.now() / 1000);
  bytes[0] = (seconds >>> 24) & 0xff;
  bytes[1] = (seconds >>> 16) & 0xff;
  bytes[2] = (seconds >>> 8) & 0xff;
  bytes[3] = seconds & 0xff;
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function enqueue(entry: Omit<QueuedEntry, "status" | "attempts">): Promise<QueuedEntry> {
  const record: QueuedEntry = { ...entry, status: "pending", attempts: 0 };
  await tx("readwrite", (store) => store.put(record));
  return record;
}

export async function pending(): Promise<QueuedEntry[]> {
  const all = await tx<QueuedEntry[]>("readonly", (store) => store.getAll() as IDBRequest<QueuedEntry[]>);
  return all.filter((e) => e.status === "pending");
}

export async function pendingCount(): Promise<number> {
  try {
    return (await pending()).length;
  } catch {
    return 0;
  }
}

async function markSynced(ids: string[]): Promise<void> {
  for (const id of ids) {
    await tx("readwrite", (store) => store.delete(id));
  }
}

async function markFailed(entry: QueuedEntry, error: string): Promise<void> {
  await tx("readwrite", (store) => store.put({ ...entry, attempts: entry.attempts + 1, lastError: error }));
}

export interface FlushResult {
  saved: number;
  remaining: number;
  offline: boolean;
  error?: string;
}

let flushing = false;

/** Pushes everything queued. Safe to call often; it self-serialises. */
export async function flush(): Promise<FlushResult> {
  if (flushing) return { saved: 0, remaining: await pendingCount(), offline: false };
  flushing = true;
  try {
    const items = await pending();
    if (items.length === 0) return { saved: 0, remaining: 0, offline: false };
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { saved: 0, remaining: items.length, offline: true };
    }

    const res = await fetch("/api/entries/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entries: items.map((e) => ({
          id: e.id,
          body: e.body,
          private: e.private,
          capturedAt: e.capturedAt,
          updatedAt: e.updatedAt,
        })),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => String(res.status));
      for (const item of items) await markFailed(item, text.slice(0, 200));
      return { saved: 0, remaining: items.length, offline: false, error: `server said ${res.status}` };
    }

    const { saved, failed } = (await res.json()) as { saved: string[]; failed: { id?: string; error: string }[] };
    await markSynced(saved);
    for (const f of failed) {
      const item = items.find((i) => i.id === f.id);
      if (item) await markFailed(item, f.error);
    }
    return { saved: saved.length, remaining: await pendingCount(), offline: false };
  } catch (err) {
    // Almost always "there is no network". The entries stay queued.
    return { saved: 0, remaining: await pendingCount(), offline: true, error: (err as Error).message };
  } finally {
    flushing = false;
  }
}

/** Queued entries that have not synced yet, for the "just captured" list. */
export async function allQueued(): Promise<QueuedEntry[]> {
  try {
    return await tx<QueuedEntry[]>("readonly", (store) => store.getAll() as IDBRequest<QueuedEntry[]>);
  } catch {
    return [];
  }
}

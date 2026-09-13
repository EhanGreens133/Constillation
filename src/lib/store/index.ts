import { env } from "../env";
import { createFileStore } from "./file";
import { createMongoStore } from "./mongo";
import type { Store } from "./types";

export type { Collection, FindOpts, ScoredId, Store } from "./types";
export type { Filter, Sort, UpdateOps } from "./query";

/**
 * Backend choice, and only one rule: if MONGODB_URI is set, Mongo is the
 * store. We never silently fall back to local files when Atlas is merely
 * unreachable - that would split the archive in two. An unreachable database
 * surfaces as a failed write, which the offline queue in the browser already
 * knows how to hold onto until it can be retried.
 */

declare global {
  // eslint-disable-next-line no-var
  var __constellationStore: Promise<Store> | undefined;
}

export function getStore(): Promise<Store> {
  if (!globalThis.__constellationStore) {
    globalThis.__constellationStore = env.mongoUri
      ? createMongoStore(env.mongoUri, env.mongoDb)
      : Promise.resolve(createFileStore(env.dataDir));
    globalThis.__constellationStore.catch(() => {
      globalThis.__constellationStore = undefined;
    });
  }
  return globalThis.__constellationStore;
}

export async function resetStore(): Promise<void> {
  const existing = globalThis.__constellationStore;
  globalThis.__constellationStore = undefined;
  if (existing) {
    const store = await existing.catch(() => null);
    await store?.close();
  }
}

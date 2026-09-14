/**
 * Creates the indexes the brief specifies:
 *   { clusterId, whenHappened }, { private }, { deletedAt },
 *   an Atlas Search index over body/title/attribution,
 *   and a vector index over embedding.
 *
 * Safe to re-run. On a plain mongod, or on the local JSON store, the search
 * indexes are reported as skipped - which is not a failure: search falls back
 * to a lexical scan and relatedness to TF-IDF.
 *
 *   npm run indexes
 */

import { loadEnv } from "./lib/load-env";
loadEnv();

import { getStore, resetStore } from "../src/lib/store";

const store = await getStore();
console.log(`backend: ${store.backend}`);
for (const line of await store.ensureIndexes()) console.log(`  ${line}`);
await resetStore();

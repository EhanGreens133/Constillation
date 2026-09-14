/**
 * Seeds the configured store with synthetic entries, for trying the star view
 * and the export at a realistic size.
 *
 *   npm run seed                 500 entries
 *   npm run seed -- 5000         the size the brief asks about
 *   npm run seed -- 5000 --work  also rethread and relax the layout
 *
 * It writes to whatever MONGODB_URI / DATA_DIR points at. Synthetic entries
 * all start with "[seed]" so you can find and delete them again.
 */

import { loadEnv } from "./lib/load-env";
loadEnv();

import { syntheticBody } from "./lib/fixtures";
import { getStore, resetStore } from "../src/lib/store";
import { getArchive, putArchive } from "../src/lib/archive";
import { createCluster, listClusters } from "../src/lib/clusters";
import { rethreadAll } from "../src/lib/related";
import { runLayout } from "../src/lib/layout";
import { KINDS, type EntryDoc } from "../src/lib/types";

const count = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 500);
const doWork = process.argv.includes("--work");

const store = await getStore();
console.log(`backend: ${store.backend}`);

let clusters = await listClusters();
if (clusters.length === 0) {
  for (const name of ["Family", "Work", "Music", "Places", "Things I was taught"]) {
    await createCluster({ name });
  }
  clusters = await listClusters();
}

if (!(await getArchive())?.opening) {
  await putArchive({
    title: "What I kept",
    opening:
      "If you are reading this, it is because I wanted you to.\n\nThere is no order to it. Start anywhere, and stop when you have had enough. Some of it is difficult; I left it in on purpose, because leaving it out would have been a kind of lie.\n\nI am glad you are here.",
  });
  console.log("wrote a placeholder opening message (replace it with your own)");
}

const start = Date.now();
const batchSize = 500;
let written = 0;

for (let offset = 0; offset < count; offset += batchSize) {
  const docs: EntryDoc[] = [];
  for (let i = offset; i < Math.min(offset + batchSize, count); i++) {
    const titled = i % 6 === 0;
    const filed = i % 3 !== 0;
    // The index is in the text so every synthetic body is unique: repeated
    // filler would make a leak check impossible to interpret.
    const body = `[seed ${i}] ${syntheticBody(i)}`;
    const whenWritten = new Date(Date.now() - i * 7_200_000);
    docs.push({
      _id: "",
      body,
      title: titled ? body.slice(body.indexOf("] ") + 2, body.indexOf("] ") + 42) : "",
      titleSource: titled ? "suggested" : "",
      kind: KINDS[i % KINDS.length],
      kindSource: i % 5 === 0 ? "author" : "suggested",
      clusterId: filed ? clusters[i % clusters.length]._id : null,
      clusterSource: filed ? "author" : "suggested",
      attribution: i % 23 === 0 ? "Overheard" : "",
      whenHappened: i % 4 === 0 ? 1968 + (i % 55) : null,
      whenWritten,
      reflections:
        i % 11 === 0
          ? [{ at: new Date(whenWritten.getTime() + 86_400_000 * 400), text: "Reading this back, I would say it differently now." }]
          : [],
      private: i % 41 === 0,
      related: [],
      position: { x: 0, y: 0, pinned: false },
      createdAt: whenWritten,
      updatedAt: whenWritten,
      deletedAt: null,
    });
  }
  written += await store.entries.insertMany(docs);
  process.stdout.write(`\rseeded ${written}/${count}`);
}
await store.flush();
console.log(`\n${written} entries in ${((Date.now() - start) / 1000).toFixed(1)}s`);

if (doWork) {
  console.log("rethreading…");
  const stats = await rethreadAll({ onProgress: (d, t) => process.stdout.write(`\r  ${d}/${t}`) });
  console.log(
    `\n  ${stats.entries} entries, basis ${stats.basis}: ${stats.vectorLinks} vector, ${stats.lexicalLinks} lexical, ${(stats.tookMs / 1000).toFixed(1)}s`,
  );
  console.log("relaxing layout…");
  const layout = await runLayout({ fresh: true });
  console.log(`  ${layout.nodes} nodes, ${layout.iterations} iterations, ${(layout.tookMs / 1000).toFixed(1)}s`);
}

await resetStore();
console.log("done");

/**
 * Measures the two things that decide whether the star view is usable at
 * scale: how long the layout relaxation takes, and how much work a single
 * frame has to do once viewport culling is applied.
 *
 *   npm run bench:layout            5,000 entries
 *   npm run bench:layout -- 20000
 */

import { relaxLayout, type LayoutNode } from "../src/lib/layout";
import type { ClusterDoc } from "../src/lib/types";

const n = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 5000);

const clusters: ClusterDoc[] = ["Family", "Work", "Music", "Places", "Lessons"].map((name, i) => ({
  _id: `cluster${i}`.padEnd(24, "0"),
  name,
  color: "#8a6f36",
  order: i,
}));

const nodes: LayoutNode[] = [];
for (let i = 0; i < n; i++) {
  nodes.push({
    _id: String(i).padStart(24, "0"),
    clusterId: i % 3 === 0 ? null : clusters[i % clusters.length]._id,
    related: [1, 2, 3, 4]
      .map((k) => (i * 7 + k * 977) % n)
      .filter((j) => j !== i)
      .map((j) => ({ entryId: String(j).padStart(24, "0"), score: 0.72 + (j % 20) / 100, basis: "lexical" })),
  });
}

console.log(`relaxing ${n} nodes across ${clusters.length + 1} regions…`);
const result = relaxLayout(nodes, clusters, { fresh: true });
console.log(`  ${result.iterations} iterations in ${(result.tookMs / 1000).toFixed(2)}s`);
console.log(`  ${(result.tookMs / result.iterations).toFixed(1)}ms per iteration`);

// How many points land inside one phone-sized viewport at a few zoom levels.
const positions = [...result.positions.values()];
const bounds = positions.reduce(
  (b, p) => ({
    minX: Math.min(b.minX, p.x),
    maxX: Math.max(b.maxX, p.x),
    minY: Math.min(b.minY, p.y),
    maxY: Math.max(b.maxY, p.y),
  }),
  { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
);
const worldW = bounds.maxX - bounds.minX;
const worldH = bounds.maxY - bounds.minY;
const screen = { w: 390, h: 700 };
const fitScale = Math.min(screen.w / worldW, screen.h / worldH);

// Regions sit on a ring, so the middle of the world is empty. Measuring the
// viewport there would flatter the numbers; centre on the busiest region.
const busiest = result.regions.reduce((a, b) => (b.count > a.count ? b : a), result.regions[0]);

console.log(
  `\nworld is ${Math.round(worldW)} x ${Math.round(worldH)} units; the whole thing fits a 390x700 screen at scale ${fitScale.toFixed(3)}`,
);
console.log(`centring on "${busiest.name}" (${busiest.count} entries), the densest region:\n`);

// The same spatial grid the canvas uses, so these counts are the real ones.
const CELL = 220;
const grid = new Map<string, { x: number; y: number }[]>();
for (const p of positions) {
  const key = `${Math.floor(p.x / CELL)}:${Math.floor(p.y / CELL)}`;
  const bucket = grid.get(key);
  if (bucket) bucket.push(p);
  else grid.set(key, [p]);
}

function frameWork(scale: number, cx: number, cy: number): { culled: number; ms: number } {
  const halfW = screen.w / 2 / scale;
  const halfH = screen.h / 2 / scale;
  const cx0 = Math.floor((cx - halfW) / CELL);
  const cx1 = Math.floor((cx + halfW) / CELL);
  const cy0 = Math.floor((cy - halfH) / CELL);
  const cy1 = Math.floor((cy + halfH) / CELL);
  const t0 = performance.now();
  let drawn = 0;
  let sink = 0;
  // 60 frames' worth of the work a frame actually does: walk the visible
  // cells, transform each point. Rasterising is the browser's job.
  for (let frame = 0; frame < 60; frame++) {
    drawn = 0;
    const ox = screen.w / 2 - cx * scale;
    const oy = screen.h / 2 - cy * scale;
    for (let gx = cx0; gx <= cx1; gx++) {
      for (let gy = cy0; gy <= cy1; gy++) {
        const bucket = grid.get(`${gx}:${gy}`);
        if (!bucket) continue;
        for (const p of bucket) {
          sink += p.x * scale + ox + (p.y * scale + oy);
          drawn++;
        }
      }
    }
  }
  if (sink === Infinity) console.log("");
  return { culled: drawn, ms: (performance.now() - t0) / 60 };
}

for (const zoom of [1, 2, 4, 8, 16]) {
  const scale = fitScale * zoom;
  const { culled, ms } = frameWork(scale, busiest.x, busiest.y);
  const budget = ms < 33 ? "within a 33ms frame" : "OVER the 33ms frame budget";
  console.log(
    `  zoom x${String(zoom).padStart(2)}  scale ${scale.toFixed(3)}  points per frame: ${String(culled).padStart(5)}  ` +
      `transform+cull ${ms.toFixed(2)}ms  (${budget})` +
      (zoom === 1 ? "\n           ^ whole archive in view: squares, no labels, no threads" : ""),
  );
}

console.log(
  "\nA frame only ever touches the points inside the viewport, and the numbers above are\n" +
    "the cull and transform cost of that. 33ms is the 30fps budget; rasterising a few\n" +
    "thousand 2px squares is a fraction of what remains.",
);

import { getStore } from "./store";
import type { ClusterDoc, EntryDoc } from "./types";

/**
 * Layout for the star view.
 *
 * Clusters are regions. Region centres sit on a ring whose radius grows with
 * the total number of entries, so regions stay apart as the archive fills.
 * Inside and between regions, positions are relaxed against the `related`
 * graph: attraction along connections, repulsion between near neighbours via
 * a spatial grid, and a weak spring to the region centre.
 *
 * It runs iteratively, the result is cached in `position`, and it only re-runs
 * on demand or after bulk changes. The point of all of it: proximity on
 * screen should mean shared content, not insertion order.
 */

export interface LayoutNode {
  _id: string;
  clusterId: string | null;
  related: { entryId: string; score: number; basis: string }[];
  position?: { x: number; y: number; pinned: boolean };
}

export interface Region {
  /** cluster id, or "" for the unfiled region */
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  radius: number;
  count: number;
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  regions: Region[];
  iterations: number;
  tookMs: number;
}

export const UNFILED_REGION_ID = "";
const UNFILED_COLOR = "#8a93a6";

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Region geometry. Deterministic, so the server and the viewer agree. */
export function computeRegions(
  clusters: ClusterDoc[],
  counts: Map<string, number>,
  total: number,
): Region[] {
  const ids: { id: string; name: string; color: string }[] = [
    ...clusters
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ id: c._id, name: c.name, color: c.color })),
  ];
  const unfiledCount = counts.get(UNFILED_REGION_ID) ?? 0;
  if (unfiledCount > 0 || ids.length === 0) {
    ids.push({ id: UNFILED_REGION_ID, name: "Unfiled", color: UNFILED_COLOR });
  }

  // Ring radius scales with the square root of the archive: area per region
  // grows linearly with entries, so regions never start colliding.
  const ringRadius = ids.length <= 1 ? 0 : Math.max(700, 150 * Math.sqrt(Math.max(total, 1)));
  return ids.map((meta, i) => {
    const count = counts.get(meta.id) ?? 0;
    const angle = (i / Math.max(ids.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return {
      ...meta,
      x: Math.cos(angle) * ringRadius,
      y: Math.sin(angle) * ringRadius,
      radius: Math.max(180, 58 * Math.sqrt(Math.max(count, 1)) + 120),
      count,
    };
  });
}

export interface RelaxOptions {
  iterations?: number;
  /** Ignore cached positions and start from the region seeding again. */
  fresh?: boolean;
}

export function relaxLayout(
  nodes: LayoutNode[],
  clusters: ClusterDoc[],
  opts: RelaxOptions = {},
): LayoutResult {
  const started = Date.now();
  const n = nodes.length;
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const key = node.clusterId ?? UNFILED_REGION_ID;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const regions = computeRegions(clusters, counts, n);
  const regionIndex = new Map(regions.map((r, i) => [r.id, i]));

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const pinned = new Uint8Array(n);
  const region = new Int32Array(n);
  const indexOf = new Map<string, number>();

  nodes.forEach((node, i) => {
    indexOf.set(node._id, i);
    const ri = regionIndex.get(node.clusterId ?? UNFILED_REGION_ID) ?? 0;
    region[i] = ri;
    const r = regions[ri] ?? { x: 0, y: 0, radius: 300 };
    const cached = node.position;
    if (cached && (cached.pinned || (!opts.fresh && (cached.x !== 0 || cached.y !== 0)))) {
      x[i] = cached.x;
      y[i] = cached.y;
      pinned[i] = cached.pinned ? 1 : 0;
    } else {
      // Deterministic seeding inside the region: same archive, same picture.
      const rand = mulberry32(hash32(node._id));
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * r.radius;
      x[i] = r.x + Math.cos(a) * d;
      y[i] = r.y + Math.sin(a) * d;
    }
  });

  // Edge list, de-duplicated, author links pulling hardest.
  const edgeA: number[] = [];
  const edgeB: number[] = [];
  const edgeW: number[] = [];
  const seen = new Set<number>();
  nodes.forEach((node, i) => {
    for (const link of node.related ?? []) {
      const j = indexOf.get(link.entryId);
      if (j === undefined || j === i) continue;
      const key = i < j ? i * n + j : j * n + i;
      if (seen.has(key)) continue;
      seen.add(key);
      edgeA.push(i);
      edgeB.push(j);
      edgeW.push(link.basis === "author" ? 1.6 : Math.max(0.2, Math.min(1, link.score)));
    }
  });

  const iterations = opts.iterations ?? (n > 3000 ? 120 : 180);
  const REST = 46;
  const NEAR = 78;
  const K_ATTRACT = 0.35;
  const K_REPEL = 34;
  const K_REGION = 0.045;
  const cell = NEAR;

  const grid = new Map<number, number[]>();
  const cellKey = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768);

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = Math.max(0.05, 1 - iter / iterations);
    dx.fill(0);
    dy.fill(0);

    // attraction along stored connections
    for (let e = 0; e < edgeA.length; e++) {
      const i = edgeA[e];
      const j = edgeB[e];
      let vx = x[j] - x[i];
      let vy = y[j] - y[i];
      let d = Math.hypot(vx, vy);
      if (d < 0.01) {
        vx = (hash32(`${i}:${j}`) % 100) / 100 - 0.5;
        vy = (hash32(`${j}:${i}`) % 100) / 100 - 0.5;
        d = 0.5;
      }
      const force = (K_ATTRACT * edgeW[e] * (d - REST)) / d;
      dx[i] += vx * force;
      dy[i] += vy * force;
      dx[j] -= vx * force;
      dy[j] -= vy * force;
    }

    // repulsion between near neighbours, via a spatial grid
    grid.clear();
    for (let i = 0; i < n; i++) {
      const key = cellKey(Math.floor(x[i] / cell), Math.floor(y[i] / cell));
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(x[i] / cell);
      const cy = Math.floor(y[i] / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get(cellKey(cx + ox, cy + oy));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            let vx = x[j] - x[i];
            let vy = y[j] - y[i];
            let d2 = vx * vx + vy * vy;
            if (d2 > NEAR * NEAR) continue;
            if (d2 < 0.01) {
              vx = ((hash32(`r${i}:${j}`) % 1000) / 1000 - 0.5) * 2;
              vy = ((hash32(`r${j}:${i}`) % 1000) / 1000 - 0.5) * 2;
              d2 = vx * vx + vy * vy || 1;
            }
            const d = Math.sqrt(d2);
            const force = (K_REPEL * (1 - d / NEAR)) / d;
            dx[i] -= vx * force;
            dy[i] -= vy * force;
            dx[j] += vx * force;
            dy[j] += vy * force;
          }
        }
      }
    }

    // weak spring to the region centre
    for (let i = 0; i < n; i++) {
      const r = regions[region[i]];
      if (!r) continue;
      const vx = r.x - x[i];
      const vy = r.y - y[i];
      const d = Math.hypot(vx, vy) || 1;
      const pull = K_REGION * Math.max(0, d - r.radius * 0.35);
      dx[i] += (vx / d) * pull;
      dy[i] += (vy / d) * pull;
    }

    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const step = 6 * alpha;
      const len = Math.hypot(dx[i], dy[i]);
      const scale = len > step ? step / len : 1;
      x[i] += dx[i] * scale;
      y[i] += dy[i] * scale;
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, i) => {
    positions.set(node._id, { x: Math.round(x[i] * 100) / 100, y: Math.round(y[i] * 100) / 100 });
  });

  return { positions, regions, iterations, tookMs: Date.now() - started };
}

/** Loads, relaxes and caches. Called on demand, never on a read path. */
export async function runLayout(opts: RelaxOptions = {}): Promise<{
  nodes: number;
  regions: Region[];
  iterations: number;
  tookMs: number;
  pinned: number;
}> {
  const store = await getStore();
  const [clusters, nodes] = await Promise.all([
    store.clusters.find({}, { sort: { order: 1 } }),
    store.entries.find(
      { deletedAt: null },
      { projection: { embedding: 0, body: 0, reflections: 0 }, limit: 100000 },
    ) as Promise<EntryDoc[]>,
  ]);

  const result = relaxLayout(
    nodes.map((e) => ({
      _id: e._id,
      clusterId: e.clusterId,
      related: e.related ?? [],
      position: e.position,
    })),
    clusters,
    opts,
  );

  let pinnedCount = 0;
  for (const node of nodes) {
    if (node.position?.pinned) {
      pinnedCount++;
      continue;
    }
    const p = result.positions.get(node._id);
    if (!p) continue;
    await store.entries.update(
      { _id: node._id },
      { $set: { position: { x: p.x, y: p.y, pinned: false } } },
    );
  }

  return {
    nodes: nodes.length,
    regions: result.regions,
    iterations: result.iterations,
    tookMs: result.tookMs,
    pinned: pinnedCount,
  };
}

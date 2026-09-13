import { fail, json, requireAuthor } from "@/lib/api";
import { getStore } from "@/lib/store";
import { computeRegions, UNFILED_REGION_ID } from "@/lib/layout";
import { displayTitle } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The star view payload, sent columnar rather than as an array of objects:
 * at 5,000+ entries that difference is most of the transfer size and most of
 * the parse time on a mid-range phone.
 */
export async function GET(req: Request) {
  try {
    await requireAuthor();
    const url = new URL(req.url);
    const includePrivate = url.searchParams.get("includePrivate") !== "0";
    const store = await getStore();

    const filter = includePrivate ? { deletedAt: null } : { deletedAt: null, private: false };
    const [clusters, entries] = await Promise.all([
      store.clusters.find({}, { sort: { order: 1 } }),
      store.entries.find(filter, { projection: { embedding: 0 }, limit: 100000 }),
    ]);

    const clusterIndex = new Map(clusters.map((c, i) => [c._id, i]));
    const indexOf = new Map<string, number>();
    entries.forEach((e, i) => indexOf.set(e._id, i));

    const ids: string[] = [];
    const x: number[] = [];
    const y: number[] = [];
    const cluster: number[] = [];
    const pinned: number[] = [];
    const priv: number[] = [];
    const titles: string[] = [];
    const counts = new Map<string, number>();

    for (const e of entries) {
      ids.push(e._id);
      x.push(e.position?.x ?? 0);
      y.push(e.position?.y ?? 0);
      cluster.push(e.clusterId ? (clusterIndex.get(e.clusterId) ?? -1) : -1);
      pinned.push(e.position?.pinned ? 1 : 0);
      priv.push(e.private ? 1 : 0);
      titles.push(displayTitle(e).text);
      const key = e.clusterId ?? UNFILED_REGION_ID;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // Edges de-duplicated to one direction; author links flagged so the
    // canvas can draw them differently.
    const edges: number[] = [];
    entries.forEach((e, i) => {
      for (const link of e.related ?? []) {
        const j = indexOf.get(link.entryId);
        if (j === undefined || j <= i) continue;
        edges.push(i, j, link.basis === "author" ? 1 : 0);
      }
    });

    return json({
      count: entries.length,
      clusters: clusters.map((c) => ({ _id: c._id, name: c.name, color: c.color })),
      regions: computeRegions(clusters, counts, entries.length),
      ids,
      x,
      y,
      cluster,
      pinned,
      private: priv,
      titles,
      edges,
      unpositioned: entries.filter((e) => !e.position || (e.position.x === 0 && e.position.y === 0)).length,
    });
  } catch (err) {
    return fail(err);
  }
}

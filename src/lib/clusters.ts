import { getStore } from "./store";
import { HttpError } from "./entries";
import { CLUSTER_COLORS, type ClusterDoc } from "./types";

export async function listClusters(): Promise<ClusterDoc[]> {
  const store = await getStore();
  return store.clusters.find({}, { sort: { order: 1 } });
}

export async function createCluster(input: { name: string; color?: string; order?: number }): Promise<ClusterDoc> {
  const name = (input.name ?? "").trim();
  if (!name) throw new HttpError(400, "name is required");
  const store = await getStore();
  const existing = await store.clusters.find({}, { sort: { order: 1 } });
  const color = input.color?.trim() || CLUSTER_COLORS[existing.length % CLUSTER_COLORS.length];
  const order = input.order ?? (existing.length ? existing[existing.length - 1].order + 1 : 0);
  return store.clusters.insert({ _id: "", name, color, order } as ClusterDoc);
}

export async function updateCluster(
  id: string,
  patch: { name?: string; color?: string; order?: number },
): Promise<ClusterDoc> {
  const store = await getStore();
  const $set: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw new HttpError(400, "name cannot be empty");
    $set.name = name;
  }
  if (patch.color !== undefined) $set.color = String(patch.color).trim();
  if (patch.order !== undefined) $set.order = Number(patch.order) || 0;
  const updated = await store.clusters.updateOne({ _id: id }, { $set });
  if (!updated) throw new HttpError(404, "cluster not found");
  return updated;
}

/**
 * Deleting a cluster returns its entries to the unfiled state. No entry is
 * ever lost with its folder - unfiled is a valid place for an entry to live
 * permanently, so this is a complete outcome, not a broken one.
 */
export async function deleteCluster(id: string): Promise<{ unfiled: number }> {
  const store = await getStore();
  const cluster = await store.clusters.findOne({ _id: id });
  if (!cluster) throw new HttpError(404, "cluster not found");
  const unfiled = await store.entries.update(
    { clusterId: id },
    { $set: { clusterId: null, clusterSource: "author", updatedAt: new Date() } },
  );
  await store.clusters.remove({ _id: id });
  return { unfiled };
}

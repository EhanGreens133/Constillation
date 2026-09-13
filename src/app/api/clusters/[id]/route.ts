import { fail, json, readJson, requireAuthor } from "@/lib/api";
import { deleteCluster, updateCluster } from "@/lib/clusters";
import { toClusterDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await requireAuthor();
    const { id } = await ctx.params;
    const patch = await readJson<{ name?: string; color?: string; order?: number }>(req);
    const cluster = await updateCluster(id, patch);
    return json({ cluster: toClusterDTO(cluster) });
  } catch (err) {
    return fail(err);
  }
}

/** Deleting a cluster unfiles its entries. None are lost. */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await requireAuthor();
    const { id } = await ctx.params;
    const { unfiled } = await deleteCluster(id);
    return json({ ok: true, unfiled, note: `${unfiled} entries are now unfiled; none were deleted` });
  } catch (err) {
    return fail(err);
  }
}

import { fail, json, readJson, requireAuthor } from "@/lib/api";
import { createCluster, listClusters } from "@/lib/clusters";
import { toClusterDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthor();
    const clusters = await listClusters();
    return json({ clusters: clusters.map(toClusterDTO) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    await requireAuthor();
    const body = await readJson<{ name: string; color?: string; order?: number }>(req);
    const cluster = await createCluster(body);
    return json({ cluster: toClusterDTO(cluster) }, 201);
  } catch (err) {
    return fail(err);
  }
}

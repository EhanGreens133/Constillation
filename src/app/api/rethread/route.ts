import { fail, json, requireAuthor } from "@/lib/api";
import { rethreadAll } from "@/lib/related";
import { runLayout } from "@/lib/layout";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Recomputes related[] for every entry, then relaxes the star layout against
 * the new graph. On demand only - never on a read path.
 */
export async function POST(req: Request) {
  try {
    await requireAuthor();
    const relayout = new URL(req.url).searchParams.get("layout") !== "0";
    const stats = await rethreadAll();
    const layout = relayout ? await runLayout({ fresh: true }) : null;
    return json({ ...stats, layout });
  } catch (err) {
    return fail(err);
  }
}

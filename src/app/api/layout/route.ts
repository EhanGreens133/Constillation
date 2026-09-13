import { fail, json, requireAuthor } from "@/lib/api";
import { runLayout } from "@/lib/layout";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Re-runs the layout relaxation and caches the positions. On demand only. */
export async function POST(req: Request) {
  try {
    await requireAuthor();
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    return json(await runLayout({ fresh }));
  } catch (err) {
    return fail(err);
  }
}

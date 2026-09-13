import { fail, json, readJson, requireAuthor } from "@/lib/api";
import { nextSuggestionBatch, suggestForEntries } from "@/lib/suggest";
import { toEntryDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Takes entry ids, returns proposals, and writes nothing.
 *
 * That is deliberate and it is the whole design of the naming pass:
 * suggestions are proposals the author accepts or rejects one at a time.
 * Nothing here can take effect on its own.
 */
export async function POST(req: Request) {
  try {
    await requireAuthor();
    const { entryIds } = await readJson<{ entryIds: string[] }>(req);
    if (!Array.isArray(entryIds) || entryIds.length === 0) {
      return json({ error: "entryIds[] required" }, 400);
    }
    if (entryIds.length > 20) {
      return json({ error: "at most 20 entries per pass" }, 400);
    }
    const result = await suggestForEntries(entryIds);
    return json({ ...result, wrote: "nothing" });
  } catch (err) {
    return fail(err);
  }
}

/** The next batch of unfiled or untitled entries to offer. */
export async function GET(req: Request) {
  try {
    await requireAuthor();
    const size = Number(new URL(req.url).searchParams.get("size") ?? 12);
    const entries = await nextSuggestionBatch(size);
    return json({ entries: entries.map(toEntryDTO) });
  } catch (err) {
    return fail(err);
  }
}

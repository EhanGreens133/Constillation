import { fail, json, readJson, requireAuthor } from "@/lib/api";
import { captureEntry, type CaptureInput } from "@/lib/entries";
import { toEntryDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Offline queue drain. The browser holds captures in IndexedDB while there is
 * no connectivity and posts them here in a batch when it returns. Each entry
 * carries the id it was given offline and its own timestamps, so a retry is
 * idempotent and conflicts resolve per entry by last write wins.
 */
export async function POST(req: Request) {
  try {
    await requireAuthor();
    const { entries } = await readJson<{ entries: CaptureInput[] }>(req);
    if (!Array.isArray(entries)) return json({ error: "entries[] required" }, 400);

    const saved: string[] = [];
    const failed: { id?: string; error: string }[] = [];
    for (const input of entries) {
      try {
        const entry = await captureEntry(input);
        saved.push(entry._id);
      } catch (err) {
        failed.push({ id: input.id, error: (err as Error).message });
      }
    }
    return json({ saved, failed });
  } catch (err) {
    return fail(err);
  }
}

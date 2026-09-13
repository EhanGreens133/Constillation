import { fail, json, readJson, requireAuthor } from "@/lib/api";
import { getEntry, patchEntry, softDeleteEntry, type EntryPatch } from "@/lib/entries";
import { toEntryDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    await requireAuthor();
    const { id } = await ctx.params;
    const entry = await getEntry(id);
    if (!entry) return json({ error: "entry not found" }, 404);
    return json({ entry: toEntryDTO(entry) });
  } catch (err) {
    return fail(err);
  }
}

/** Edits. Rejects any attempt to change whenWritten. */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await requireAuthor();
    const { id } = await ctx.params;
    const patch = await readJson<EntryPatch>(req);
    const entry = await patchEntry(id, patch);
    return json({ entry: toEntryDTO(entry) });
  } catch (err) {
    return fail(err);
  }
}

/** Soft delete only. This is an archive. */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await requireAuthor();
    const { id } = await ctx.params;
    await softDeleteEntry(id);
    return json({ ok: true, note: "soft deleted; the entry is retained and can be restored" });
  } catch (err) {
    return fail(err);
  }
}

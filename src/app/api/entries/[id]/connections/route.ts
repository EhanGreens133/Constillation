import { fail, json, readJson, requireAuthor } from "@/lib/api";
import { connectEntries, disconnectEntries, getEntry } from "@/lib/entries";
import { toEntryDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Connections the author makes by hand. Stored with basis "author", which
 * always ranks above anything the machine derived and survives a rethread.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    await requireAuthor();
    const { id } = await ctx.params;
    const { entryId } = await readJson<{ entryId: string }>(req);
    await connectEntries(id, entryId);
    const entry = await getEntry(id);
    return json({ entry: entry ? toEntryDTO(entry) : null }, 201);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    await requireAuthor();
    const { id } = await ctx.params;
    const entryId = new URL(req.url).searchParams.get("entryId");
    if (!entryId) return json({ error: "entryId required" }, 400);
    await disconnectEntries(id, entryId);
    const entry = await getEntry(id);
    return json({ entry: entry ? toEntryDTO(entry) : null });
  } catch (err) {
    return fail(err);
  }
}

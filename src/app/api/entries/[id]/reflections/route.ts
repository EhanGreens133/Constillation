import { fail, json, readJson, requireAuthor } from "@/lib/api";
import { addReflection } from "@/lib/entries";
import { toEntryDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Appends a later thought. The body of the entry is untouched. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    await requireAuthor();
    const { id } = await ctx.params;
    const { text, at } = await readJson<{ text: string; at?: string }>(req);
    const entry = await addReflection(id, text, at);
    return json({ entry: toEntryDTO(entry) }, 201);
  } catch (err) {
    return fail(err);
  }
}

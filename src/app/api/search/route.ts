import { boolParam, fail, json, requireAuthor } from "@/lib/api";
import { searchEntries } from "@/lib/search";
import { toEntryDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAuthor();
    const p = new URL(req.url).searchParams;
    const q = p.get("q") ?? "";
    const { hits, engine, took } = await searchEntries(q, {
      limit: p.get("limit") ? Number(p.get("limit")) : 50,
      includePrivate: boolParam(p.get("includePrivate")) ?? true,
    });
    return json({
      q,
      engine,
      tookMs: took,
      hits: hits.map((h) => ({
        entry: toEntryDTO(h.entry),
        score: h.score,
        snippet: h.snippet,
        terms: h.terms,
      })),
    });
  } catch (err) {
    return fail(err);
  }
}

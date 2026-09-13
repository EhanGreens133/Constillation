import { boolParam, fail, json, requireAuthor } from "@/lib/api";
import { getFacets } from "@/lib/entries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAuthor();
    const includePrivate = boolParam(new URL(req.url).searchParams.get("includePrivate")) ?? true;
    const facets = await getFacets({ includePrivate });
    return json({
      ...facets,
      // Carried alongside the numbers so no caller can present them as a
      // measure of how significant a year was.
      writtenByYearNote:
        "Counts entries written in each calendar year. Pain generates writing; contentment often generates none.",
    });
  } catch (err) {
    return fail(err);
  }
}

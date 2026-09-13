import { boolParam, fail, json, readJson, requireAuthor } from "@/lib/api";
import { captureEntry, listEntries, splitOnBlankLines, type CaptureInput, type ListQuery } from "@/lib/entries";
import { isKind, toEntryDTO, type Kind } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Capture. `body` is required and nothing else is: no title, no category, no
 * date, no tags. The response returns as soon as the write lands; the
 * embedding is computed afterwards and is allowed to fail.
 */
export async function POST(req: Request) {
  try {
    await requireAuthor();
    const input = await readJson<CaptureInput & { split?: boolean }>(req);
    if (typeof input.body !== "string" || input.body.trim() === "") {
      return json({ error: "body is required" }, 400);
    }

    // Splitting is opt-in. Paragraph breaks inside one reflection are common,
    // and splitting them by default would destroy the context.
    if (input.split) {
      const parts = splitOnBlankLines(input.body);
      const created = [];
      for (const part of parts) {
        created.push(await captureEntry({ ...input, id: undefined, body: part }));
      }
      return json({ entries: created.map(toEntryDTO), split: true }, 201);
    }

    const entry = await captureEntry(input);
    return json({ entry: toEntryDTO(entry) }, 201);
  } catch (err) {
    return fail(err);
  }
}

export async function GET(req: Request) {
  try {
    await requireAuthor();
    const p = new URL(req.url).searchParams;
    const kind = p.get("kind");
    const query: ListQuery = {
      cluster: p.get("cluster"),
      unfiled: boolParam(p.get("unfiled")),
      untitled: boolParam(p.get("untitled")),
      year: p.get("year") ? Number(p.get("year")) : undefined,
      yearField: p.get("yearField") === "written" ? "written" : "happened",
      private: boolParam(p.get("private")),
      includePrivate: boolParam(p.get("includePrivate")) ?? true,
      kind: isKind(kind) ? (kind as Kind) : undefined,
      limit: p.get("limit") ? Number(p.get("limit")) : 100,
      skip: p.get("skip") ? Number(p.get("skip")) : 0,
      sort: (p.get("sort") as ListQuery["sort"]) ?? "written-desc",
    };
    const { entries, total } = await listEntries(query);
    return json({ entries: entries.map(toEntryDTO), total });
  } catch (err) {
    return fail(err);
  }
}

import { fail, json, readJson, requireAuthor } from "@/lib/api";
import { getArchive, putArchive } from "@/lib/archive";
import { toArchiveDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthor();
    return json({ archive: toArchiveDTO(await getArchive()) });
  } catch (err) {
    return fail(err);
  }
}

export async function PUT(req: Request) {
  try {
    await requireAuthor();
    const body = await readJson<{ title?: string; opening?: string; openingAudioUrl?: string | null }>(req);
    const archive = await putArchive(body);
    return json({ archive: toArchiveDTO(archive) });
  } catch (err) {
    return fail(err);
  }
}

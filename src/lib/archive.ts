import { getStore } from "./store";
import type { ArchiveDoc } from "./types";

/**
 * The archive document: its title and the opening message.
 *
 * The opening message is the single highest-value piece of writing in the
 * system, because it is the only place the author speaks to the reader
 * directly instead of being read sideways through fragments. The UI keeps
 * asking for it until it exists.
 */

export const ARCHIVE_ID = "archive";

export async function getArchive(): Promise<ArchiveDoc | null> {
  const store = await getStore();
  return store.archive.findOne({ _id: ARCHIVE_ID });
}

export async function putArchive(patch: {
  title?: string;
  opening?: string;
  openingAudioUrl?: string | null;
}): Promise<ArchiveDoc> {
  const store = await getStore();
  const current = await getArchive();
  const next: ArchiveDoc = {
    _id: ARCHIVE_ID,
    title: patch.title !== undefined ? String(patch.title).trim() : (current?.title ?? ""),
    opening: patch.opening !== undefined ? String(patch.opening) : (current?.opening ?? ""),
    openingAudioUrl:
      patch.openingAudioUrl !== undefined ? patch.openingAudioUrl : (current?.openingAudioUrl ?? null),
    updatedAt: new Date(),
  };
  if (current) {
    await store.archive.update({ _id: ARCHIVE_ID }, { $set: next });
  } else {
    await store.archive.insert(next);
  }
  return next;
}

export function hasOpening(archive: ArchiveDoc | null): boolean {
  return !!archive && archive.opening.trim().length > 0;
}

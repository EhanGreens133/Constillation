import { getStore } from "../store";
import { computeRegions, UNFILED_REGION_ID, type Region } from "../layout";
import { toArchiveDTO, toClusterDTO, toEntryDTO, type ArchiveDTO, type ClusterDTO, type EntryDTO } from "../types";
import { renderArchiveHtml } from "./html";
import { renderArchiveTxt } from "./txt";
import { renderReadme } from "./readme";
import { createZip, type ZipEntry } from "./zip";

export type Edition = "inheritance" | "working";
export const SCHEMA_ID = "constellation-archive-1";

export interface OpeningAudio {
  filename: string;
  mime: string;
  base64: string;
}

export interface ArchiveBundle {
  schema: string;
  generator: string;
  edition: Edition;
  builtAt: string;
  archive: ArchiveDTO;
  openingAudio: OpeningAudio | null;
  clusters: ClusterDTO[];
  entries: EntryDTO[];
  regions: Region[];
  counts: {
    entries: number;
    withTitle: number;
    unfiled: number;
    private: number;
    omittedPrivate: number;
    reflections: number;
    connections: number;
  };
  warnings: string[];
}

const MIME_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};

/**
 * Resolves the opening recording into bytes we can embed.
 *
 * The export must not depend on a URL still resolving in 2045, so a remote
 * recording is downloaded once, here, at build time. If that fails the export
 * still succeeds - it just says so in the README.
 */
async function resolveAudio(url: string | null, warnings: string[]): Promise<OpeningAudio | null> {
  if (!url) return null;
  try {
    if (url.startsWith("data:")) {
      const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
      if (!match) throw new Error("unrecognised data URL");
      const mime = match[1];
      const base64 = match[2] ? match[3] : Buffer.from(decodeURIComponent(match[3]), "utf8").toString("base64");
      return { filename: `opening-message.${MIME_EXT[mime] ?? "bin"}`, mime, base64 };
    }
    if (/^https?:\/\//.test(url)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mime = res.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg";
      const buf = Buffer.from(await res.arrayBuffer());
      return { filename: `opening-message.${MIME_EXT[mime] ?? "bin"}`, mime, base64: buf.toString("base64") };
    }
    throw new Error("unsupported URL scheme");
  } catch (err) {
    warnings.push(
      `The recording of the opening message could not be included (${(err as Error).message}). The written opening message is present.`,
    );
    return null;
  }
}

export async function buildBundle(edition: Edition): Promise<ArchiveBundle> {
  const store = await getStore();
  const warnings: string[] = [];

  const [clusterDocs, archiveDoc] = await Promise.all([
    store.clusters.find({}, { sort: { order: 1 } }),
    store.archive.findOne({ _id: "archive" }),
  ]);

  const all: EntryDTO[] = [];
  await store.entries.eachBatch(
    { deletedAt: null },
    { projection: { embedding: 0 }, sort: { whenWritten: 1 }, batchSize: 500 },
    (batch) => {
      // toEntryDTO drops `embedding` unconditionally; the projection above
      // means it was never loaded in the first place.
      for (const doc of batch) all.push(toEntryDTO(doc));
    },
  );

  const isInheritance = edition === "inheritance";
  const kept = isInheritance ? all.filter((e) => !e.private) : all;
  const surviving = new Set(kept.map((e) => e._id));

  const entries = kept.map((e) => ({
    ...e,
    // A connection that points at an entry which is not in this edition would
    // be a dead end in the reader's hands.
    related: e.related.filter((r) => surviving.has(r.entryId)),
  }));

  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.clusterId ?? UNFILED_REGION_ID, (counts.get(e.clusterId ?? UNFILED_REGION_ID) ?? 0) + 1);
  const regions = computeRegions(clusterDocs, counts, entries.length);

  const archive = toArchiveDTO(archiveDoc);
  const openingAudio = await resolveAudio(archive.openingAudioUrl, warnings);

  if (!archive.opening.trim()) {
    warnings.push(
      "This archive has no opening message. It is the only place the author speaks to the reader directly, and it is worth going back for.",
    );
  }

  return {
    schema: SCHEMA_ID,
    generator: "Constellation",
    edition,
    builtAt: new Date().toISOString(),
    archive: { ...archive, openingAudioUrl: openingAudio ? openingAudio.filename : null },
    openingAudio,
    clusters: clusterDocs.map(toClusterDTO),
    entries,
    regions,
    counts: {
      entries: entries.length,
      withTitle: entries.filter((e) => e.title).length,
      unfiled: entries.filter((e) => !e.clusterId).length,
      private: entries.filter((e) => e.private).length,
      omittedPrivate: all.length - kept.length,
      reflections: entries.reduce((n, e) => n + e.reflections.length, 0),
      connections: entries.reduce((n, e) => n + e.related.length, 0),
    },
    warnings,
  };
}

/** The structured copy, with its own field documentation inside it. */
export function renderArchiveJson(bundle: ArchiveBundle): string {
  const payload = {
    schema: bundle.schema,
    generator: bundle.generator,
    edition: bundle.edition,
    builtAt: bundle.builtAt,
    documentation: {
      about:
        "A personal archive exported by Constellation. Each entry is one thing the author wrote down. Text is exactly as the author wrote it; no field here was generated from the body text except where a *Source field says 'suggested'.",
      fields: {
        "entries[]._id": "Stable identifier, referenced by entries[].related[].entryId.",
        "entries[].body": "The author's words, verbatim. Never modified by software.",
        "entries[].title":
          "A title. An empty string means the entry was never titled; readers should be shown the opening words of the body instead, never a placeholder.",
        "entries[].titleSource": "'author', 'suggested' (proposed by software and kept by the author), or '' when there is no title.",
        "entries[].kind": "thought | story | feeling | loved | person | place | song | quote | lesson.",
        "entries[].kindSource": "'author' or 'suggested'.",
        "entries[].clusterId": "The cluster this entry was filed under, or null. null is a valid permanent state.",
        "entries[].clusterSource": "'author' or 'suggested'.",
        "entries[].attribution": "Who or what the words came from, when they are not the author's own (a quote, a song).",
        "entries[].whenHappened": "The year the thing happened, or null when unknown.",
        "entries[].whenWritten": "ISO 8601 timestamp of when the entry was captured. Set by the system, never edited.",
        "entries[].reflections[]": "Later thoughts, appended over time: { at (ISO 8601), text }. They never replace the body.",
        "entries[].private": "The author marked this entry private. Entries marked private are absent from the inheritance edition.",
        "entries[].related[]":
          "Precomputed connections: { entryId, score, basis }. basis 'author' means the author made the connection; 'vector' and 'lexical' mean software found similar wording. Similar wording is not shared meaning.",
        "entries[].position": "Cached x/y for the constellation view. pinned means the author placed it there by hand.",
        "entries[].deletedAt": "Always null in an export: deleted entries are not included.",
        "clusters[]": "Named groups: { _id, name, color, order }.",
        "regions[]": "Cached geometry for the constellation view, derived from clusters.",
      },
      threeDates:
        "whenHappened, whenWritten and reflections[].at are three different times and are deliberately not collapsed into one: what someone believed in one year and concluded in another are both part of the record.",
    },
    archive: bundle.archive,
    counts: bundle.counts,
    clusters: bundle.clusters,
    regions: bundle.regions,
    entries: bundle.entries,
  };
  return JSON.stringify(payload, null, 2);
}

export interface ExportResult {
  filename: string;
  zip: Buffer;
  bundle: ArchiveBundle;
  files: { name: string; bytes: number }[];
}

export function bundleFiles(bundle: ArchiveBundle): ZipEntry[] {
  const files: ZipEntry[] = [
    { name: "archive.html", data: renderArchiveHtml(bundle) },
    { name: "archive.txt", data: renderArchiveTxt(bundle) },
    { name: "archive.json", data: renderArchiveJson(bundle) },
    { name: "README.txt", data: renderReadme(bundle) },
  ];
  if (bundle.openingAudio) {
    // Embedded in archive.html as well; shipped alongside so it can be played
    // by anything, including a media player from thirty years from now.
    files.push({
      name: bundle.openingAudio.filename,
      data: Buffer.from(bundle.openingAudio.base64, "base64"),
      store: true,
    });
  }
  return files;
}

export async function buildExport(edition: Edition): Promise<ExportResult> {
  const bundle = await buildBundle(edition);
  const files = bundleFiles(bundle);
  const stamp = bundle.builtAt.slice(0, 10);
  return {
    filename: `constellation-${edition}-${stamp}.zip`,
    zip: createZip(files, new Date(bundle.builtAt)),
    bundle,
    files: files.map((f) => ({
      name: f.name,
      bytes: Buffer.isBuffer(f.data) ? f.data.length : Buffer.byteLength(f.data, "utf8"),
    })),
  };
}

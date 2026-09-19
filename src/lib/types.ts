/**
 * The data model. Two shapes for every record:
 *   *Doc  - server side, real Date objects, `_id` as a 24-char hex string
 *   *DTO  - what crosses the wire and what lands in the export (ISO strings)
 *
 * Ids are hex strings everywhere above the storage layer. The Mongo adapter
 * converts them to ObjectId on the way in and back on the way out, so the
 * database holds proper ObjectIds while the rest of the code (and every
 * exported file) stays plain JSON.
 */

export const KINDS = [
  "thought",
  "story",
  "feeling",
  "loved",
  "person",
  "place",
  "song",
  "quote",
  "lesson",
] as const;

export type Kind = (typeof KINDS)[number];

export function isKind(v: unknown): v is Kind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

/** Who put this value here. "" only ever appears on an empty title. */
export type Source = "author" | "suggested" | "";
export type RelatedBasis = "vector" | "lexical" | "author";

export interface Reflection {
  at: Date;
  text: string;
}

export interface RelatedLink {
  entryId: string;
  score: number;
  basis: RelatedBasis;
}

export interface Position {
  x: number;
  y: number;
  pinned: boolean;
}

export interface EntryDoc {
  _id: string;
  /** The author's words. Never modified by anything automated. */
  body: string;
  /** "" means: show the opening words of body, verbatim. Never "Untitled". */
  title: string;
  titleSource: Source;
  kind: Kind;
  kindSource: "author" | "suggested";
  /** null means unfiled. A permanent, valid resting state. */
  clusterId: string | null;
  clusterSource: "author" | "suggested";
  attribution: string;

  /** The year the thing happened. null when unknown, which is common. */
  whenHappened: number | null;
  /** When it was captured. Set by the system, never editable. */
  whenWritten: Date;
  /** Later thoughts. Appended. They never replace the body. */
  reflections: Reflection[];

  private: boolean;
  /** Precomputed and stored, so the export carries its own connections. */
  related: RelatedLink[];
  /** Never leaves the server. Stripped from every export. */
  embedding?: number[];
  position: Position;

  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ClusterDoc {
  _id: string;
  name: string;
  color: string;
  order: number;
}

/**
 * Operational settings. Deliberately a separate collection from `archive`:
 * `archive` is part of the exported artifact, and a password hash must never
 * be able to travel inside a file the author hands to their family.
 * Nothing in here is ever exported.
 */
export interface SettingsDoc {
  _id: string;
  passwordHash?: string;
  updatedAt: Date;
}

export interface ArchiveDoc {
  _id: string;
  title: string;
  /** The message the reader sees before anything else. */
  opening: string;
  openingAudioUrl: string | null;
  updatedAt: Date;
}

// --- wire / export shapes --------------------------------------------------

export interface EntryDTO {
  _id: string;
  body: string;
  title: string;
  titleSource: Source;
  kind: Kind;
  kindSource: "author" | "suggested";
  clusterId: string | null;
  clusterSource: "author" | "suggested";
  attribution: string;
  whenHappened: number | null;
  whenWritten: string;
  reflections: { at: string; text: string }[];
  private: boolean;
  related: RelatedLink[];
  position: Position;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ClusterDTO {
  _id: string;
  name: string;
  color: string;
  order: number;
}

export interface ArchiveDTO {
  title: string;
  opening: string;
  openingAudioUrl: string | null;
  updatedAt: string | null;
}

const iso = (d: Date | null | undefined): string =>
  d instanceof Date ? d.toISOString() : new Date(d ?? Date.now()).toISOString();

/** Server doc -> wire shape. Drops `embedding` unconditionally. */
export function toEntryDTO(e: EntryDoc): EntryDTO {
  return {
    _id: e._id,
    body: e.body,
    title: e.title ?? "",
    titleSource: e.titleSource ?? "",
    kind: e.kind,
    kindSource: e.kindSource,
    clusterId: e.clusterId ?? null,
    clusterSource: e.clusterSource,
    attribution: e.attribution ?? "",
    whenHappened: e.whenHappened ?? null,
    whenWritten: iso(e.whenWritten),
    reflections: (e.reflections ?? []).map((r) => ({ at: iso(r.at), text: r.text })),
    private: !!e.private,
    related: e.related ?? [],
    position: e.position ?? { x: 0, y: 0, pinned: false },
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
    deletedAt: e.deletedAt ? iso(e.deletedAt) : null,
  };
}

export function toClusterDTO(c: ClusterDoc): ClusterDTO {
  return { _id: c._id, name: c.name, color: c.color, order: c.order };
}

export function toArchiveDTO(a: ArchiveDoc | null): ArchiveDTO {
  return {
    title: a?.title ?? "",
    opening: a?.opening ?? "",
    openingAudioUrl: a?.openingAudioUrl ?? null,
    updatedAt: a?.updatedAt ? iso(a.updatedAt) : null,
  };
}

export const CLUSTER_COLORS = [
  "#e8b64c",
  "#7fb2e5",
  "#d98a8a",
  "#8fd0b0",
  "#c59ae0",
  "#e0a170",
  "#9fbfd8",
  "#cfd08a",
];

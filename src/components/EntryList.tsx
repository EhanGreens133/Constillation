"use client";

import Link from "next/link";
import { displayTitle, KIND_LABELS } from "@/lib/format";
import type { ClusterDTO, EntryDTO } from "@/lib/types";

export function Highlight({ text, terms }: { text: string; terms?: string[] }) {
  if (!terms || terms.length === 0) return <>{text}</>;
  const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "ig"));
  const lowered = terms.map((t) => t.toLowerCase());
  return (
    <>
      {parts.map((part, i) =>
        lowered.includes(part.toLowerCase()) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

export function EntryRow({
  entry,
  clusters,
  snippet,
  terms,
}: {
  entry: EntryDTO;
  clusters: ClusterDTO[];
  snippet?: string;
  terms?: string[];
}) {
  const t = displayTitle(entry);
  const cluster = entry.clusterId ? clusters.find((c) => c._id === entry.clusterId) : undefined;
  return (
    <li>
      <Link className="entry-link" href={`/entries/${entry._id}`}>
        <div className={t.excerpt ? "t excerpt" : "t"}>
          {t.text}
          {t.suggested && <span className="badge suggested" style={{ marginLeft: 8 }}>suggested title</span>}
        </div>
        {snippet && (
          <div className="snippet">
            <Highlight text={snippet} terms={terms} />
          </div>
        )}
        <div className="meta">
          {/* Category source is marked on the entry view, not on every row -
              see the note in the exported viewer. A suggested *title* is
              always marked, here and everywhere else. */}
          <span>{KIND_LABELS[entry.kind] ?? entry.kind}</span>
          {cluster ? (
            <span>
              <span className="dot" style={{ background: cluster.color, display: "inline-block", marginRight: 6 }} />
              {cluster.name}
            </span>
          ) : (
            <span>unfiled</span>
          )}
          <span>{entry.whenHappened ? `about ${entry.whenHappened}` : "year not recorded"}</span>
          <span>written {new Date(entry.whenWritten).toLocaleDateString()}</span>
          {entry.reflections.length > 0 && (
            <span>
              {entry.reflections.length} later {entry.reflections.length === 1 ? "note" : "notes"}
            </span>
          )}
          {entry.related.length > 0 && <span>{entry.related.length} nearby</span>}
          {entry.private && <span className="badge private">private</span>}
        </div>
      </Link>
    </li>
  );
}

/** Chronological list, grouped by year. */
export function GroupedEntries({ entries, clusters }: { entries: EntryDTO[]; clusters: ClusterDTO[] }) {
  const yearOf = (e: EntryDTO) => e.whenHappened ?? new Date(e.whenWritten).getFullYear();
  const groups: { year: number; entries: EntryDTO[] }[] = [];
  for (const e of entries) {
    const y = yearOf(e);
    const last = groups[groups.length - 1];
    if (last && last.year === y) last.entries.push(e);
    else groups.push({ year: y, entries: [e] });
  }
  return (
    <>
      {groups.map((g) => (
        <div key={`${g.year}-${g.entries[0]._id}`}>
          <div className="year-head">
            {g.year}
            <span>
              {g.entries.length} {g.entries.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          <ul className="entries">
            {g.entries.map((e) => (
              <EntryRow key={e._id} entry={e} clusters={clusters} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { basisLabel, displayTitle, formatDate, KIND_LABELS } from "@/lib/format";
import { KINDS, type ClusterDTO, type EntryDTO, type Kind } from "@/lib/types";

export default function EntryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [entry, setEntry] = useState<EntryDTO | null>(null);
  const [clusters, setClusters] = useState<ClusterDTO[]>([]);
  const [related, setRelated] = useState<Record<string, EntryDTO>>({});
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reflection, setReflection] = useState("");
  const [connectQuery, setConnectQuery] = useState("");
  const [connectHits, setConnectHits] = useState<EntryDTO[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ entry: EntryDTO }>(`/api/entries/${id}`);
      setEntry(r.entry);
      const ids = r.entry.related.map((x) => x.entryId);
      const fetched: Record<string, EntryDTO> = {};
      await Promise.all(
        ids.map(async (rid) => {
          try {
            const one = await api.get<{ entry: EntryDTO }>(`/api/entries/${rid}`);
            fetched[rid] = one.entry;
          } catch {
            /* a connection can point at something deleted */
          }
        }),
      );
      setRelated(fetched);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
    api.get<{ clusters: ClusterDTO[] }>("/api/clusters").then((r) => setClusters(r.clusters)).catch(() => undefined);
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.patch<{ entry: EntryDTO }>(`/api/entries/${id}`, body);
      setEntry(r.entry);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addReflection() {
    if (!reflection.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ entry: EntryDTO }>(`/api/entries/${id}/reflections`, { text: reflection });
      setEntry(r.entry);
      setReflection("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function searchToConnect(ev: React.FormEvent) {
    ev.preventDefault();
    if (!connectQuery.trim()) return;
    const r = await api.get<{ hits: { entry: EntryDTO }[] }>(
      `/api/search?q=${encodeURIComponent(connectQuery)}&limit=8`,
    );
    setConnectHits(r.hits.map((h) => h.entry).filter((e) => e._id !== id));
  }

  async function connect(other: string) {
    await api.post(`/api/entries/${id}/connections`, { entryId: other });
    setConnectHits([]);
    setConnectQuery("");
    await load();
  }

  async function disconnect(other: string) {
    await api.del(`/api/entries/${id}/connections?entryId=${other}`);
    await load();
  }

  async function remove() {
    if (!confirm("Soft delete this entry? It stays in the database and can be restored, but it leaves every export.")) {
      return;
    }
    await api.del(`/api/entries/${id}`);
    router.push("/entries");
  }

  if (error && !entry) {
    return (
      <main>
        <p className="err">{error}</p>
        <Link href="/entries">Back to the list</Link>
      </main>
    );
  }
  if (!entry) return <main><p className="empty">Loading…</p></main>;

  const t = displayTitle(entry);
  const cluster = entry.clusterId ? clusters.find((c) => c._id === entry.clusterId) : undefined;
  const authorLinks = entry.related.filter((r) => r.basis === "author");
  const machineLinks = entry.related.filter((r) => r.basis !== "author");

  return (
    <main className="prose" style={{ maxWidth: "40rem" }}>
      <p style={{ marginBottom: "0.6rem" }}>
        <Link href="/entries">← Read</Link>
      </p>

      <div className="meta" style={{ marginBottom: "0.4rem" }}>
        <span className="badge">{KIND_LABELS[entry.kind] ?? entry.kind}</span>
        {entry.kindSource === "suggested" && <span className="badge suggested">suggested category</span>}
        {cluster ? (
          <span>
            <span className="dot" style={{ background: cluster.color, display: "inline-block", marginRight: 6 }} />
            {cluster.name}
            {entry.clusterSource === "suggested" ? " (suggested)" : ""}
          </span>
        ) : (
          <span>unfiled</span>
        )}
        {entry.private && <span className="badge private">private — never leaves the working copy</span>}
      </div>

      <h1 style={t.excerpt ? { fontStyle: "italic", fontWeight: 400 } : undefined}>{t.text}</h1>
      {t.excerpt && <p className="note">Never titled. These are its opening words, shown verbatim.</p>}
      {t.suggested && (
        <p className="note">
          <span className="badge suggested">suggested title</span> proposed by software, kept by you.{" "}
          <button className="ghost" onClick={() => void patch({ title: "" })} disabled={busy}>
            Revert to the opening words
          </button>
        </p>
      )}

      <div className="body-text" style={{ margin: "1.4rem 0" }}>
        {entry.body}
      </div>
      {entry.attribution && <p style={{ fontStyle: "italic", color: "var(--ink-soft)" }}>— {entry.attribution}</p>}

      <h2>When</h2>
      <dl className="dates">
        <dt>The year it happened</dt>
        <dd>{entry.whenHappened ?? "not recorded"}</dd>
        <dt>Written down</dt>
        <dd>{formatDate(entry.whenWritten)}</dd>
        <dt>Later notes</dt>
        <dd>
          {entry.reflections.length
            ? `${entry.reflections.length}, most recent ${formatDate(entry.reflections[entry.reflections.length - 1].at)}`
            : "none"}
        </dd>
      </dl>
      <p className="note">
        These are three different times on purpose. What you believed then and what you concluded later are both part of
        the record.
      </p>

      <h2>Later notes</h2>
      {entry.reflections.length === 0 && <p className="note">None yet.</p>}
      {[...entry.reflections]
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
        .map((r, i) => (
          <div className="reflection" key={i}>
            <span className="when">{formatDate(r.at)}</span>
            {r.text}
          </div>
        ))}
      <div className="field">
        <textarea
          rows={3}
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
          placeholder="Something you think about this now. It is added alongside; the entry itself is never changed."
        />
      </div>
      <button onClick={() => void addReflection()} disabled={busy || !reflection.trim()}>
        Add a later note
      </button>

      <h2>Nearby entries</h2>
      {entry.related.length === 0 ? (
        <p className="note">
          None stored yet. Connections are computed on demand — run a rethread from the Constellation screen.
        </p>
      ) : (
        <ul className="entries">
          {[...authorLinks, ...machineLinks].map((r) => {
            const other = related[r.entryId];
            if (!other) return null;
            const ot = displayTitle(other);
            return (
              <li key={r.entryId}>
                <div style={{ padding: "0.6rem 0" }}>
                  <Link href={`/entries/${r.entryId}`} style={{ textDecoration: "none" }}>
                    <span className={ot.excerpt ? "t excerpt" : "t"}>{ot.text}</span>
                  </Link>
                  <div className="meta">
                    <span>{basisLabel(r.basis)}</span>
                    {r.basis !== "author" && <span>score {r.score.toFixed(2)}</span>}
                    <button className="ghost small" onClick={() => void disconnect(r.entryId)}>
                      {r.basis === "author" ? "remove connection" : "remove"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="note">
        Machine-found connections mean similar wording, nothing more. Two entries about the same person — one written in
        anger, one after reconciliation — look alike to it.
      </p>

      <form onSubmit={searchToConnect} className="row" style={{ marginTop: "0.8rem" }}>
        <input
          type="search"
          value={connectQuery}
          onChange={(e) => setConnectQuery(e.target.value)}
          placeholder="Connect this to another entry…"
          style={{ flex: "1 1 14rem" }}
        />
        <button type="submit">Search</button>
      </form>
      {connectHits.length > 0 && (
        <ul className="entries">
          {connectHits.map((h) => {
            const ht = displayTitle(h);
            return (
              <li key={h._id}>
                <div className="row" style={{ padding: "0.5rem 0", justifyContent: "space-between" }}>
                  <span className={ht.excerpt ? "t excerpt" : "t"}>{ht.text}</span>
                  <button className="small" onClick={() => void connect(h._id)}>
                    Connect
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h2>Details</h2>
      {!editing ? (
        <div className="row">
          <button onClick={() => setEditing(true)}>Edit title, category, collection, year</button>
          <button className="danger" onClick={() => void remove()}>
            Delete
          </button>
        </div>
      ) : (
        <div className="card stack">
          <div className="field">
            <span className="label">Title (leave empty to show the opening words)</span>
            <input
              type="text"
              defaultValue={entry.title}
              onBlur={(e) => {
                if (e.target.value !== entry.title) void patch({ title: e.target.value });
              }}
            />
          </div>
          <div className="field">
            <span className="label">Category</span>
            <select value={entry.kind} onChange={(e) => void patch({ kind: e.target.value as Kind })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="label">Collection</span>
            <select
              value={entry.clusterId ?? ""}
              onChange={(e) => void patch({ clusterId: e.target.value || null })}
            >
              <option value="">Unfiled</option>
              {clusters.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="label">Year it happened (leave empty if unknown)</span>
            <input
              type="number"
              defaultValue={entry.whenHappened ?? ""}
              onBlur={(e) => void patch({ whenHappened: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
          <div className="field">
            <span className="label">Attribution (if these are not your own words)</span>
            <input
              type="text"
              defaultValue={entry.attribution}
              onBlur={(e) => {
                if (e.target.value !== entry.attribution) void patch({ attribution: e.target.value });
              }}
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={entry.private}
              onChange={(e) => void patch({ private: e.target.checked })}
            />
            Private — stays in your working copy, never appears in the inheritance edition
          </label>
          <p className="note">
            The date it was written cannot be changed. Editing the body is deliberately not offered here; these words
            are the record.
          </p>
          <div className="row">
            <button onClick={() => setEditing(false)}>Done</button>
          </div>
        </div>
      )}
      {error && <p className="err">{error}</p>}
    </main>
  );
}

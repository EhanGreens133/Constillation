"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { displayTitle, KIND_LABELS } from "@/lib/format";
import { KINDS, type ClusterDTO, type EntryDTO, type Kind } from "@/lib/types";

/**
 * The naming and filing pass.
 *
 * A separate screen that never blocks capture. It offers a batch of unfiled
 * or untitled entries with proposals, each one editable, each one skippable,
 * plus a way to leave the whole batch alone. Nothing is written until you
 * press Apply on a row.
 */

interface Proposal {
  entryId: string;
  title: string | null;
  kind: Kind | null;
  clusterId: string | null;
  whenHappened: number | null;
}

interface Rejection {
  entryId: string;
  field: string;
  proposed: string;
  reason: string;
}

interface Draft {
  title: string;
  kind: Kind | "";
  clusterId: string;
  whenHappened: string;
}

export default function NamingPage() {
  const [entries, setEntries] = useState<EntryDTO[]>([]);
  const [clusters, setClusters] = useState<ClusterDTO[]>([]);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [rejected, setRejected] = useState<Rejection[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [notes, setNotes] = useState<string[]>([]);
  const [engine, setEngine] = useState<string>("");
  const [done, setDone] = useState<Record<string, "applied" | "skipped">>({});
  const [size, setSize] = useState(12);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBatch = useCallback(async () => {
    setBusy(true);
    setError(null);
    setProposals({});
    setRejected([]);
    setNotes([]);
    setDone({});
    try {
      const [batch, cl] = await Promise.all([
        api.get<{ entries: EntryDTO[] }>(`/api/suggest?size=${size}`),
        api.get<{ clusters: ClusterDTO[] }>("/api/clusters"),
      ]);
      setEntries(batch.entries);
      setClusters(cl.clusters);
      setDrafts(
        Object.fromEntries(
          batch.entries.map((e) => [
            e._id,
            {
              title: e.title,
              kind: e.kindSource === "author" ? e.kind : "",
              clusterId: e.clusterId ?? "",
              whenHappened: e.whenHappened ? String(e.whenHappened) : "",
            } as Draft,
          ]),
        ),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [size]);

  useEffect(() => {
    void loadBatch();
  }, [loadBatch]);

  async function suggest() {
    if (entries.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{
        proposals: Proposal[];
        rejected: Rejection[];
        engine: string;
        notes: string[];
      }>("/api/suggest", { entryIds: entries.map((e) => e._id) });
      const map: Record<string, Proposal> = {};
      for (const p of r.proposals) map[p.entryId] = p;
      setProposals(map);
      setRejected(r.rejected);
      setNotes(r.notes);
      setEngine(r.engine);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const p of r.proposals) {
          const current = next[p.entryId] ?? { title: "", kind: "", clusterId: "", whenHappened: "" };
          next[p.entryId] = {
            title: current.title || p.title || "",
            kind: current.kind || p.kind || "",
            clusterId: current.clusterId || p.clusterId || "",
            whenHappened: current.whenHappened || (p.whenHappened ? String(p.whenHappened) : ""),
          };
        }
        return next;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply(entry: EntryDTO) {
    const draft = drafts[entry._id];
    const proposal = proposals[entry._id];
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      // Fields taken as proposed are stored as "suggested"; anything you
      // typed or changed is stored as yours. Two patches rather than one lie.
      const suggested: Record<string, unknown> = {};
      const authored: Record<string, unknown> = {};

      const put = (field: string, value: unknown, proposedValue: unknown, original: unknown) => {
        if (value === original) return;
        if (proposal && value === proposedValue && value !== null && value !== "") suggested[field] = value;
        else authored[field] = value;
      };

      put("title", draft.title.trim(), proposal?.title ?? null, entry.title);
      if (draft.kind) put("kind", draft.kind, proposal?.kind ?? null, entry.kindSource === "author" ? entry.kind : null);
      put("clusterId", draft.clusterId || null, proposal?.clusterId ?? null, entry.clusterId);
      put(
        "whenHappened",
        draft.whenHappened ? Number(draft.whenHappened) : null,
        proposal?.whenHappened ?? null,
        entry.whenHappened,
      );

      if (Object.keys(suggested).length) await api.patch(`/api/entries/${entry._id}`, { ...suggested, source: "suggested" });
      if (Object.keys(authored).length) await api.patch(`/api/entries/${entry._id}`, { ...authored, source: "author" });
      setDone((d) => ({ ...d, [entry._id]: "applied" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function skip(id: string) {
    setDone((d) => ({ ...d, [id]: "skipped" }));
  }

  const remaining = entries.filter((e) => !done[e._id]);

  return (
    <main>
      <h1>Name &amp; file</h1>
      <p className="lede">
        Optional, and never in the way of writing. Entries can stay untitled and unfiled forever — this screen exists
        for when you feel like tidying, not because anything is wrong.
      </p>

      <div className="row" style={{ marginBottom: "1rem" }}>
        <button className="primary" onClick={() => void suggest()} disabled={busy || entries.length === 0}>
          Suggest titles and filing
        </button>
        <button onClick={() => void loadBatch()} disabled={busy}>
          Leave them all alone — next batch
        </button>
        <label className="check">
          Batch of
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ width: "auto" }}>
            <option value={10}>10</option>
            <option value={12}>12</option>
            <option value={16}>16</option>
            <option value={20}>20</option>
          </select>
        </label>
      </div>

      {engine && (
        <p className="note">
          {engine === "model"
            ? "Proposals came from a model, then were checked: a suggested title must be a phrase lifted verbatim from your entry, or it is discarded."
            : "Proposals are the opening words of each entry, lifted verbatim. No model was used."}
        </p>
      )}
      {notes.map((n, i) => (
        <p className="note" key={i}>
          {n}
        </p>
      ))}
      {rejected.length > 0 && (
        <details className="card" style={{ marginBottom: "1rem" }}>
          <summary>{rejected.length} proposals were discarded by the guardrails</summary>
          <table className="plain" style={{ marginTop: "0.6rem" }}>
            <thead>
              <tr>
                <th>Field</th>
                <th>Discarded</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {rejected.map((r, i) => (
                <tr key={i}>
                  <td>{r.field}</td>
                  <td>{r.proposed}</td>
                  <td>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {error && <p className="err">{error}</p>}

      {entries.length === 0 && !busy && (
        <p className="empty">
          Nothing untitled or unfiled. <Link href="/">Go and write something</Link>.
        </p>
      )}

      {remaining.length === 0 && entries.length > 0 && (
        <p className="note">
          Batch finished. <button className="ghost" onClick={() => void loadBatch()}>Load the next one</button>
        </p>
      )}

      {entries.map((entry) => {
        const draft = drafts[entry._id];
        const proposal = proposals[entry._id];
        const state = done[entry._id];
        if (!draft) return null;
        const t = displayTitle(entry);
        return (
          <div className="card" key={entry._id} style={state ? { opacity: 0.55 } : undefined}>
            <div className="spread">
              <div className={t.excerpt ? "t excerpt" : "t"}>{t.text}</div>
              {state && <span className="badge ok">{state}</span>}
            </div>
            <div
              className="body-text"
              style={{ fontSize: "0.98rem", maxHeight: "9rem", overflow: "auto", margin: "0.6rem 0 1rem" }}
            >
              {entry.body}
            </div>

            <div className="field">
              <span className="label">
                Title{" "}
                {proposal?.title ? (
                  <span className="badge suggested">proposed: {proposal.title}</span>
                ) : proposal ? (
                  <span className="badge">no title proposed — that is a fine outcome</span>
                ) : null}
              </span>
              <input
                type="text"
                value={draft.title}
                placeholder="Leave empty to keep showing the opening words"
                onChange={(e) => setDrafts((d) => ({ ...d, [entry._id]: { ...draft, title: e.target.value } }))}
              />
            </div>

            <div className="row">
              <div className="field" style={{ flex: "1 1 12rem" }}>
                <span className="label">Category</span>
                <select
                  value={draft.kind}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [entry._id]: { ...draft, kind: e.target.value as Kind | "" } }))
                  }
                >
                  <option value="">(none)</option>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: "1 1 12rem" }}>
                <span className="label">Collection</span>
                <select
                  value={draft.clusterId}
                  onChange={(e) => setDrafts((d) => ({ ...d, [entry._id]: { ...draft, clusterId: e.target.value } }))}
                >
                  <option value="">Unfiled</option>
                  {clusters.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: "0 0 8rem" }}>
                <span className="label">Year</span>
                <input
                  type="number"
                  value={draft.whenHappened}
                  placeholder="unknown"
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [entry._id]: { ...draft, whenHappened: e.target.value } }))
                  }
                />
              </div>
            </div>

            <div className="row">
              <button className="primary" onClick={() => void apply(entry)} disabled={busy || !!state}>
                Apply
              </button>
              <button onClick={() => skip(entry._id)} disabled={!!state}>
                Skip
              </button>
              <Link className="btn" href={`/entries/${entry._id}`}>
                Open
              </Link>
            </div>
          </div>
        );
      })}
    </main>
  );
}

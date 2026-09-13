"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { EntryRow, GroupedEntries } from "@/components/EntryList";
import type { ClusterDTO, EntryDTO } from "@/lib/types";

/**
 * Reading. Three ways in, all first-class: wander (the constellation), find
 * (search and a plain chronological list) and filter (collections, years).
 */

interface Facets {
  total: number;
  privateCount: number;
  unfiled: number;
  untitled: number;
  clusters: Record<string, number>;
  writtenByYear: { year: number; count: number }[];
}

interface SearchHit {
  entry: EntryDTO;
  snippet: string;
  terms: string[];
}

export default function ReadPage() {
  const [clusters, setClusters] = useState<ClusterDTO[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [entries, setEntries] = useState<EntryDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [engine, setEngine] = useState<string>("");
  const [took, setTook] = useState<number>(0);
  const [query, setQuery] = useState("");
  const [cluster, setCluster] = useState<string | null>(null);
  const [unfiled, setUnfiled] = useState(false);
  const [untitled, setUntitled] = useState(false);
  const [onlyPrivate, setOnlyPrivate] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const [sort, setSort] = useState<"written-desc" | "happened-asc">("written-desc");
  const [limit, setLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ clusters: ClusterDTO[] }>("/api/clusters").then((r) => setClusters(r.clusters)).catch(() => undefined);
    api.get<Facets>("/api/facets").then(setFacets).catch(() => undefined);

    // Honour links from elsewhere in the app - /entries?cluster=…,
    // ?unfiled=1, ?untitled=1, ?year=1998, ?q=… - read from the URL rather
    // than useSearchParams so this page needs no Suspense boundary.
    const p = new URLSearchParams(window.location.search);
    if (p.get("cluster")) setCluster(p.get("cluster"));
    if (p.get("unfiled")) setUnfiled(true);
    if (p.get("untitled")) setUntitled(true);
    if (p.get("private")) setOnlyPrivate(true);
    if (p.get("year")) setYear(Number(p.get("year")));
    const q = p.get("q");
    if (q) {
      setQuery(q);
      api
        .get<{ hits: SearchHit[]; engine: string; tookMs: number }>(`/api/search?q=${encodeURIComponent(q)}&limit=100`)
        .then((r) => {
          setHits(r.hits);
          setEngine(r.engine);
          setTook(r.tookMs);
        })
        .catch(() => undefined);
    }
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (cluster) p.set("cluster", cluster);
      if (unfiled) p.set("unfiled", "1");
      if (untitled) p.set("untitled", "1");
      if (onlyPrivate) p.set("private", "1");
      if (year !== null) {
        p.set("year", String(year));
        p.set("yearField", "written");
      }
      p.set("limit", String(limit));
      p.set("sort", sort);
      const r = await api.get<{ entries: EntryDTO[]; total: number }>(`/api/entries?${p}`);
      setEntries(r.entries);
      setTotal(r.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [cluster, unfiled, untitled, onlyPrivate, year, limit, sort]);

  useEffect(() => {
    if (hits === null) void load();
  }, [load, hits]);

  async function runSearch(ev: React.FormEvent) {
    ev.preventDefault();
    if (!query.trim()) {
      setHits(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.get<{ hits: SearchHit[]; engine: string; tookMs: number }>(
        `/api/search?q=${encodeURIComponent(query)}&limit=100`,
      );
      setHits(r.hits);
      setEngine(r.engine);
      setTook(r.tookMs);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function clearFilters() {
    setCluster(null);
    setUnfiled(false);
    setUntitled(false);
    setOnlyPrivate(false);
    setYear(null);
    setHits(null);
    setQuery("");
  }

  const maxYear = facets?.writtenByYear.reduce((m, y) => Math.max(m, y.count), 0) ?? 0;
  const filtered = cluster || unfiled || untitled || onlyPrivate || year !== null;

  return (
    <main>
      <div className="spread">
        <h1>Read</h1>
        <Link className="btn" href="/stars">
          Wander the constellation →
        </Link>
      </div>
      <p className="lede">
        {facets ? `${facets.total} entries. ${facets.untitled} untitled, ${facets.unfiled} unfiled — both fine.` : " "}
      </p>

      <form onSubmit={runSearch} className="row" style={{ marginBottom: "0.6rem" }}>
        <input
          type="search"
          value={query}
          placeholder="Search every word…"
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: "1 1 20rem" }}
        />
        <button type="submit" disabled={busy}>
          Find
        </button>
        {hits !== null && (
          <button type="button" className="ghost" onClick={() => setHits(null)}>
            Back to the list
          </button>
        )}
      </form>

      {hits === null && (
        <>
          <div className="chips">
            {clusters.map((c) => (
              <button
                key={c._id}
                className="chip"
                aria-pressed={cluster === c._id}
                onClick={() => {
                  setCluster(cluster === c._id ? null : c._id);
                  setUnfiled(false);
                }}
              >
                <span className="dot" style={{ background: c.color }} />
                {c.name}
                {facets ? ` (${facets.clusters[c._id] ?? 0})` : ""}
              </button>
            ))}
            <button
              className="chip"
              aria-pressed={unfiled}
              onClick={() => {
                setUnfiled(!unfiled);
                setCluster(null);
              }}
            >
              Unfiled{facets ? ` (${facets.unfiled})` : ""}
            </button>
            <button className="chip" aria-pressed={untitled} onClick={() => setUntitled(!untitled)}>
              Untitled{facets ? ` (${facets.untitled})` : ""}
            </button>
            <button className="chip" aria-pressed={onlyPrivate} onClick={() => setOnlyPrivate(!onlyPrivate)}>
              Private{facets ? ` (${facets.privateCount})` : ""}
            </button>
            <button
              className="chip"
              aria-pressed={sort === "happened-asc"}
              onClick={() => setSort(sort === "happened-asc" ? "written-desc" : "happened-asc")}
            >
              {sort === "happened-asc" ? "Oldest first" : "Newest written first"}
            </button>
            {filtered && (
              <button className="chip" onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>

          {facets && facets.writtenByYear.length > 1 && (
            <div style={{ marginBottom: "1.4rem" }}>
              <h3 style={{ margin: "0 0 0.1rem" }}>Entries written per year</h3>
              <p className="note" style={{ marginBottom: "0.4rem" }}>
                This counts writing, not how significant a year was. Pain generates writing; contentment often
                generates none.
              </p>
              <div className="histogram">
                {facets.writtenByYear.map((y) => (
                  <button
                    key={y.year}
                    className="bar"
                    aria-pressed={year === y.year}
                    title={`${y.count} written in ${y.year}`}
                    style={{ height: `${Math.max(4, Math.round((y.count / maxYear) * 78))}px` }}
                    onClick={() => setYear(year === y.year ? null : y.year)}
                  />
                ))}
              </div>
              <div className="hist-labels">
                {facets.writtenByYear.map((y) => (
                  <span key={y.year}>{String(y.year).slice(2)}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="err">{error}</p>}

      {hits !== null ? (
        <>
          <p className="note">
            {hits.length} {hits.length === 1 ? "entry" : "entries"} matched
            {engine ? ` (${engine === "atlas" ? "Atlas Search" : "lexical scan"}, ${took}ms)` : ""}.
          </p>
          {hits.length === 0 ? (
            <p className="empty">Nothing matched. Try a shorter word.</p>
          ) : (
            <ul className="entries">
              {hits.map((h) => (
                <EntryRow key={h.entry._id} entry={h.entry} clusters={clusters} snippet={h.snippet} terms={h.terms} />
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="note">
            Showing {entries.length} of {total}
            {year !== null ? ` written in ${year}` : ""}.
          </p>
          {entries.length === 0 ? (
            <p className="empty">{busy ? "Loading…" : "Nothing here yet."}</p>
          ) : sort === "happened-asc" ? (
            <GroupedEntries entries={entries} clusters={clusters} />
          ) : (
            <ul className="entries">
              {entries.map((e) => (
                <EntryRow key={e._id} entry={e} clusters={clusters} />
              ))}
            </ul>
          )}
          {entries.length < total && (
            <button style={{ marginTop: "1.4rem" }} onClick={() => setLimit(limit + 200)}>
              Show more ({total - entries.length} remaining)
            </button>
          )}
        </>
      )}
    </main>
  );
}

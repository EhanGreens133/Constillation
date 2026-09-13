"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { CLUSTER_COLORS, type ClusterDTO } from "@/lib/types";

export default function ClustersPage() {
  const [clusters, setClusters] = useState<ClusterDTO[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [unfiled, setUnfiled] = useState(0);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [c, f] = await Promise.all([
        api.get<{ clusters: ClusterDTO[] }>("/api/clusters"),
        api.get<{ clusters: Record<string, number>; unfiled: number }>("/api/facets"),
      ]);
      setClusters(c.clusters);
      setCounts(f.clusters);
      setUnfiled(f.unfiled);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(ev: React.FormEvent) {
    ev.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/clusters", { name, color: CLUSTER_COLORS[clusters.length % CLUSTER_COLORS.length] });
      setName("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(cluster: ClusterDTO) {
    const n = counts[cluster._id] ?? 0;
    if (
      !confirm(
        `Delete "${cluster.name}"? Its ${n} ${n === 1 ? "entry" : "entries"} become unfiled. Nothing is deleted with it.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await api.del<{ unfiled: number }>(`/api/clusters/${cluster._id}`);
      setStatus(`"${cluster.name}" deleted. ${r.unfiled} ${r.unfiled === 1 ? "entry is" : "entries are"} now unfiled.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Collections</h1>
      <p className="lede">
        Groups you made, for your own convenience. Unfiled is a valid permanent home for an entry — most writing never
        gets filed, and that costs nothing.
      </p>

      <form className="row" onSubmit={create} style={{ marginBottom: "1.4rem" }}>
        <input
          type="text"
          value={name}
          placeholder="New collection name…"
          onChange={(e) => setName(e.target.value)}
          style={{ flex: "1 1 16rem" }}
        />
        <button type="submit" disabled={busy || !name.trim()}>
          Add
        </button>
      </form>

      {error && <p className="err">{error}</p>}
      {status && <p className="note">{status}</p>}

      <table className="plain">
        <thead>
          <tr>
            <th>Collection</th>
            <th>Entries</th>
            <th>Colour</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {clusters.map((c) => (
            <tr key={c._id}>
              <td>
                <input
                  type="text"
                  defaultValue={c.name}
                  onBlur={async (e) => {
                    if (e.target.value !== c.name) {
                      await api.patch(`/api/clusters/${c._id}`, { name: e.target.value });
                      await load();
                    }
                  }}
                />
              </td>
              <td>
                <Link href={`/entries?cluster=${c._id}`}>{counts[c._id] ?? 0}</Link>
              </td>
              <td>
                <div className="row">
                  {CLUSTER_COLORS.map((col) => (
                    <button
                      key={col}
                      title={col}
                      aria-pressed={col === c.color}
                      onClick={async () => {
                        await api.patch(`/api/clusters/${c._id}`, { color: col });
                        await load();
                      }}
                      style={{
                        background: col,
                        width: 18,
                        height: 18,
                        padding: 0,
                        borderRadius: "50%",
                        border: col === c.color ? "2px solid var(--ink)" : "1px solid var(--line)",
                      }}
                    />
                  ))}
                </div>
              </td>
              <td>
                <button className="danger small" onClick={() => void remove(c)} disabled={busy}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          <tr>
            <td>
              <em>Unfiled</em>
            </td>
            <td>
              <Link href="/entries?unfiled=1">{unfiled}</Link>
            </td>
            <td colSpan={2} className="note">
              Cannot be deleted, and does not need to be emptied.
            </td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

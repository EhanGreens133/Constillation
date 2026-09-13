"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { enqueue, flush, newClientId, pendingCount } from "@/lib/client/queue";
import { api } from "@/lib/client/api";
import type { EntryDTO } from "@/lib/types";
import { displayTitle } from "@/lib/format";

/**
 * Capture.
 *
 * One text area and a save button. No required title, category, date or tag -
 * writing something down is: type, save. Everything else is optional and
 * stays optional forever.
 *
 * The save path is local-first: the entry lands in IndexedDB before anything
 * touches the network, so a save cannot fail for want of connectivity.
 */
export function CaptureForm() {
  const [body, setBody] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [split, setSplit] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);
  const [recent, setRecent] = useState<EntryDTO[]>([]);
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
    void refresh();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  async function refresh() {
    setQueued(await pendingCount());
    try {
      const { entries } = await api.get<{ entries: EntryDTO[] }>("/api/entries?limit=6&sort=written-desc");
      setRecent(entries);
    } catch {
      /* offline: the queue indicator is the feedback that matters */
    }
  }

  async function save() {
    const text = body;
    if (!text.trim()) return;
    setSaving(true);
    try {
      // Splitting is opt-in and resolved here, so each part is queued as its
      // own final entry. Default off: paragraph breaks inside one reflection
      // are common, and splitting them destroys the context.
      const parts = split
        ? text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean)
        : [text];
      const now = new Date().toISOString();
      for (const part of parts) {
        await enqueue({ id: newClientId(), body: part, private: isPrivate, capturedAt: now, updatedAt: now });
      }
      setBody("");
      setPrivate(false);
      area.current?.focus();
      const result = await flush();
      setToast(
        result.offline || result.remaining > 0
          ? `Saved on this device${parts.length > 1 ? ` (${parts.length} entries)` : ""}. It will sync when you are back online.`
          : `Saved${parts.length > 1 ? ` as ${parts.length} entries` : ""}.`,
      );
      await refresh();
    } catch (err) {
      setToast(`Could not save locally: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(ev: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
      ev.preventDefault();
      void save();
    }
  }

  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  return (
    <div>
      <div className="field">
        <textarea
          ref={area}
          rows={14}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Whatever it is."
          aria-label="Write something"
          style={{ fontSize: "1.06rem", minHeight: "40vh" }}
        />
      </div>

      <div className="spread">
        <div className="row">
          <button className="primary" onClick={() => void save()} disabled={saving || !body.trim()}>
            Save
          </button>
          <span className="note">{words > 0 ? `${words} word${words === 1 ? "" : "s"}` : "Ctrl+Enter saves"}</span>
        </div>
        <div className="row" style={{ gap: 16 }}>
          <label className="check">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
            Private
          </label>
          <label className="check" title="Off by default: a blank line inside one reflection is normal, and splitting on it would break the context.">
            <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
            Split on blank lines
          </label>
        </div>
      </div>

      {queued > 0 && (
        <p className="note" style={{ marginTop: "1rem" }}>
          {queued} {queued === 1 ? "entry is" : "entries are"} saved on this device and waiting to sync. Nothing is lost
          if you close the tab.
        </p>
      )}

      {recent.length > 0 && (
        <>
          <h2>Just written</h2>
          <ul className="entries">
            {recent.map((e) => {
              const t = displayTitle(e);
              return (
                <li key={e._id}>
                  <Link className="entry-link" href={`/entries/${e._id}`}>
                    <div className={t.excerpt ? "t excerpt" : "t"}>{t.text}</div>
                    <div className="meta">
                      <span>{new Date(e.whenWritten).toLocaleString()}</span>
                      {!e.title && <span>untitled</span>}
                      {!e.clusterId && <span>unfiled</span>}
                      {e.private && <span className="badge private">private</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

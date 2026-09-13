"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ArchiveDTO } from "@/lib/types";

interface Facets {
  total: number;
  privateCount: number;
  untitled: number;
  unfiled: number;
}

export default function ExportPage() {
  const [facets, setFacets] = useState<Facets | null>(null);
  const [archive, setArchive] = useState<ArchiveDTO | null>(null);

  useEffect(() => {
    api.get<Facets>("/api/facets").then(setFacets).catch(() => undefined);
    api.get<{ archive: ArchiveDTO }>("/api/archive").then((r) => setArchive(r.archive)).catch(() => undefined);
  }, []);

  const inheritanceCount = facets ? facets.total - facets.privateCount : null;

  return (
    <main>
      <h1>Export</h1>
      <p className="lede">
        This is the part that matters. The database is a convenience while you are alive; the exported file is the
        archive. It opens with no server, no internet, no account and no install.
      </p>

      {archive && !archive.opening.trim() && (
        <div className="offline-banner">
          There is no opening message yet, so every copy you download today will begin with a blank space where you
          should have been. <a href="/opening">Write it first</a>.
        </div>
      )}

      <div className="card">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Inheritance edition</h2>
          <span className="badge ok">for the people who will read it</span>
        </div>
        <p className="note">
          Everything except the entries you marked private
          {facets ? ` (${facets.privateCount} left out, ${inheritanceCount} included)` : ""}. Embeddings are stripped
          and connections that pointed at a private entry are removed, so no dead ends are left behind.
        </p>
        <div className="row" style={{ marginTop: "0.8rem" }}>
          <a className="btn primary" href="/api/export?edition=inheritance&format=zip">
            Download the zip
          </a>
          <a className="btn" href="/api/export?edition=inheritance&format=html">
            archive.html only
          </a>
          <a className="btn" href="/api/export?edition=inheritance&format=txt">
            archive.txt only
          </a>
          <a className="btn" href="/api/export?edition=inheritance&format=json">
            archive.json only
          </a>
        </div>
      </div>

      <div className="card">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Working copy</h2>
          <span className="badge private">includes private entries</span>
        </div>
        <p className="note">
          Everything, including the {facets?.privateCount ?? 0} entries marked private. This is your backup, not
          something to hand over.
        </p>
        <div className="row" style={{ marginTop: "0.8rem" }}>
          <a className="btn" href="/api/export?edition=working&format=zip">
            Download the zip
          </a>
          <a className="btn" href="/api/export?edition=working&format=txt">
            archive.txt only
          </a>
        </div>
      </div>

      <h2>What is in the zip</h2>
      <table className="plain">
        <tbody>
          <tr>
            <td>
              <b>archive.html</b>
            </td>
            <td>
              One file containing the viewer and the whole archive. Double-click it, offline, on a machine that has
              never seen this application: the opening message appears, then everything, with search, collections, the
              timeline and the constellation. No fetch calls, no CDN, no network fonts.
            </td>
          </tr>
          <tr>
            <td>
              <b>archive.txt</b>
            </td>
            <td>
              Everything as plain UTF-8, chronological, with titles, bodies, attributions and later notes. The copy
              most likely to still open in forty years.
            </td>
          </tr>
          <tr>
            <td>
              <b>archive.json</b>
            </td>
            <td>The structured data, documenting its own schema, for moving the archive somewhere else later.</td>
          </tr>
          <tr>
            <td>
              <b>README.txt</b>
            </td>
            <td>Plain language, for a non-technical reader: what this is, how to open it, and which file is the fallback.</td>
          </tr>
        </tbody>
      </table>

      <h2>Verify it properly</h2>
      <p className="note">Test the artifact, not the intention. Once per meaningful change:</p>
      <ol className="note">
        <li>Download the inheritance zip and copy it to a USB stick.</li>
        <li>Take it to another machine. Turn networking off — actually off, not just an offline claim.</li>
        <li>Unzip and double-click <b>archive.html</b>. The opening message must appear first.</li>
        <li>Search for a word you know is in there. Open an entry. Follow a connection.</li>
        <li>Open <b>archive.txt</b> and confirm the same entries are in it.</li>
        <li>
          If you marked anything private, confirm it is <i>not</i> present — search the text file for a phrase from it.
        </li>
      </ol>
      <p className="note">
        <code>npm run verify:export</code> does steps 3 to 6 mechanically, including the check that nothing private
        leaked and that the HTML makes no network requests.
      </p>

      <h2>Then give it away</h2>
      <p className="note">
        A copy in one place is not a copy. Put it on your own drive, a USB stick in a drawer, and with the person named
        on the <a href="/handover">handover page</a>. There is no service to keep paying for and nothing to renew.
      </p>
    </main>
  );
}

import type { ArchiveBundle } from "./build";
import { VIEWER_CSS } from "./viewer-css";
import { VIEWER_JS } from "./viewer-js";

/**
 * archive.html - one file, no dependencies.
 *
 * Double-clicked on a machine that has never seen this application, with no
 * network, it shows the opening message and then the entire archive with full
 * navigation. There are no fetch calls, no CDN links and no network fonts;
 * the data is embedded as JSON in a script tag.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Embedded JSON must not be able to close the script element, so every "<" is
 * replaced with its JSON unicode escape, which parses back identically. The
 * same goes for the two separators that are legal in JSON but count as line
 * terminators in JavaScript.
 */
export function embedJson(value: unknown): string {
  // U+2028 and U+2029 are legal in JSON but are line terminators in
  // JavaScript, so they are matched by code point rather than typed here.
  const lineSeparator = new RegExp(String.fromCharCode(0x2028), "g");
  const paragraphSeparator = new RegExp(String.fromCharCode(0x2029), "g");
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(lineSeparator, "\\u2028")
    .replace(paragraphSeparator, "\\u2029");
}

export function renderArchiveHtml(bundle: ArchiveBundle): string {
  const title = bundle.archive.title.trim() || "An archive";
  const opening = bundle.archive.opening.trim();
  const audio = bundle.openingAudio;

  const data = {
    schema: bundle.schema,
    generator: bundle.generator,
    edition: bundle.edition,
    builtAt: bundle.builtAt,
    archive: bundle.archive,
    counts: bundle.counts,
    clusters: bundle.clusters,
    regions: bundle.regions,
    entries: bundle.entries,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="generator" content="Constellation">
<meta name="description" content="A personal archive. ${bundle.counts.entries} entries. Built ${escapeHtml(bundle.builtAt)}.">
<style>${VIEWER_CSS}</style>
</head>
<body>

<!--
  This file contains an entire personal archive and everything needed to read
  it. It needs no internet connection, no account and no software beyond the
  browser you are reading it in. Copy it anywhere; it will keep working.

  If it ever stops working, archive.txt in the same folder holds the same
  words as plain text.

  Edition: ${escapeHtml(bundle.edition)}
  Entries: ${bundle.counts.entries}
  Built:   ${escapeHtml(bundle.builtAt)}
-->

<section id="opening">
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    ${
      opening
        ? `<div class="opening-text">${escapeHtml(opening)}</div>`
        : `<p class="opening-none">The author did not leave an opening message in this edition.</p>`
    }
    ${
      audio
        ? `<audio controls preload="metadata" src="data:${escapeHtml(audio.mime)};base64,${audio.base64}">
      Your browser cannot play this recording. The file ${escapeHtml(audio.filename)} sits next to this page.
    </audio>`
        : ""
    }
    <button id="enter" class="primary" type="button">Open the archive</button>
    <p class="hint">
      ${bundle.counts.entries} entries. You can read them in order, search them, or look at the map.
      Nothing you do here is recorded anywhere, and nothing is sent over the internet.
    </p>
  </div>
</section>

<main id="app" style="display:none"></main>

<noscript>
  <div class="wrap">
    <h1>${escapeHtml(title)}</h1>
    ${opening ? `<div class="opening-text">${escapeHtml(opening)}</div>` : ""}
    <p>
      This page needs JavaScript to browse ${bundle.counts.entries} entries. If that is switched off or
      unavailable, open <b>archive.txt</b> in the same folder - it contains the whole archive as plain text.
    </p>
  </div>
</noscript>

<script type="application/json" id="archive-data">${embedJson(data)}</script>
<script>${VIEWER_JS}</script>
</body>
</html>
`;
}

/**
 * Styles for the exported archive. Inlined into archive.html.
 *
 * System fonts only - no font is loaded over the network, because the file
 * has to render identically on a machine that has never had an internet
 * connection. Print styles are included: someone will want it on paper.
 */
export const VIEWER_CSS = String.raw`
:root {
  color-scheme: light dark;
  --bg: #fbfaf7;
  --bg-soft: #f2efe9;
  --panel: #ffffff;
  --ink: #1f1d1a;
  --ink-soft: #55514b;
  --ink-faint: #85807a;
  --line: #e2ddd4;
  --accent: #8a6f36;
  --accent-soft: #f1e8d4;
  --star: #b99a4e;
  --radius: 10px;
  --measure: 34rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14151a;
    --bg-soft: #1b1d24;
    --panel: #1b1d24;
    --ink: #ece9e3;
    --ink-soft: #b6b1a9;
    --ink-faint: #8b867f;
    --line: #2c2f38;
    --accent: #d9bd77;
    --accent-soft: #2a2620;
    --star: #e8cf92;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--ink);
  font: 17px/1.62 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-text-size-adjust: 100%;
}
a { color: var(--accent); }
button {
  font: inherit;
  color: inherit;
  background: none;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 0.45em 0.9em;
  cursor: pointer;
}
button:hover { border-color: var(--accent); }
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  padding: 0.7em 1.4em;
  font-size: 1.05em;
}
@media (prefers-color-scheme: dark) { button.primary { color: #17140d; } }
button.plain { border: 0; padding: 0.3em 0; color: var(--accent); }
.wrap { max-width: 62rem; margin: 0 auto; padding: 24px 18px 96px; }
.prose { max-width: var(--measure); }

/* --- opening ---------------------------------------------------------- */
#opening {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 18px;
  background: radial-gradient(circle at 50% 20%, var(--bg-soft), var(--bg) 70%);
}
#opening .card { max-width: 40rem; width: 100%; }
#opening h1 { font-size: clamp(1.7rem, 5vw, 2.5rem); line-height: 1.2; margin: 0 0 1.4rem; font-weight: 600; }
.opening-text {
  white-space: pre-wrap;
  font-size: 1.1rem;
  line-height: 1.72;
  border-left: 3px solid var(--accent);
  padding-left: 1.1rem;
  margin-bottom: 1.8rem;
}
.opening-none { color: var(--ink-faint); font-style: italic; margin-bottom: 1.8rem; }
audio { width: 100%; margin-bottom: 1.6rem; }
.hint { color: var(--ink-faint); font-size: 0.92rem; margin-top: 1.6rem; }

/* --- chrome ----------------------------------------------------------- */
header.bar {
  position: sticky;
  top: 0;
  z-index: 5;
  background: color-mix(in srgb, var(--bg) 92%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}
.bar-inner {
  max-width: 62rem;
  margin: 0 auto;
  padding: 10px 18px;
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
}
.bar-title { font-weight: 600; margin-right: auto; }
nav.tabs { display: flex; gap: 6px; flex-wrap: wrap; }
nav.tabs a {
  text-decoration: none;
  color: var(--ink-soft);
  padding: 0.35em 0.7em;
  border-radius: var(--radius);
  font-size: 0.95rem;
}
nav.tabs a[aria-current="true"] { background: var(--accent-soft); color: var(--ink); }
h2.section { font-size: 1.35rem; margin: 0 0 0.3rem; font-weight: 600; }
p.note { color: var(--ink-faint); font-size: 0.92rem; max-width: var(--measure); margin: 0 0 1.6rem; }

/* --- lists ------------------------------------------------------------ */
.year-head {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 2.2rem 0 0.2rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--line);
}
.year-head span { font-weight: 400; color: var(--ink-faint); font-size: 0.9rem; margin-left: 0.5rem; }
ul.entries { list-style: none; margin: 0; padding: 0; }
ul.entries li { border-bottom: 1px solid var(--line); }
a.entry-link {
  display: block;
  padding: 0.85rem 0;
  text-decoration: none;
  color: inherit;
}
a.entry-link:hover .t { color: var(--accent); }
.t { font-weight: 550; }
.t.excerpt { font-style: italic; font-weight: 400; color: var(--ink-soft); }
.meta { color: var(--ink-faint); font-size: 0.85rem; margin-top: 0.2rem; display: flex; gap: 0.7rem; flex-wrap: wrap; }
.snippet { color: var(--ink-soft); font-size: 0.95rem; margin-top: 0.25rem; }
mark { background: var(--accent-soft); color: inherit; padding: 0 0.1em; }

/* --- badges ----------------------------------------------------------- */
.badge {
  display: inline-block;
  font-size: 0.72rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0.1em 0.6em;
  color: var(--ink-faint);
  white-space: nowrap;
}
.badge.suggested {
  border-color: var(--accent);
  color: var(--accent);
  text-transform: none;
  letter-spacing: 0;
}
.dot { width: 0.6em; height: 0.6em; border-radius: 50%; display: inline-block; }

/* --- entry ------------------------------------------------------------ */
article.entry { max-width: var(--measure); }
article.entry h1 { font-size: 1.6rem; line-height: 1.28; margin: 0.4rem 0 0.2rem; font-weight: 600; }
article.entry h1.excerpt { font-style: italic; font-weight: 400; }
.body { white-space: pre-wrap; font-size: 1.08rem; line-height: 1.74; margin: 1.4rem 0; }
.attribution { color: var(--ink-soft); font-style: italic; margin: -0.6rem 0 1.4rem; }
.dates { border-top: 1px solid var(--line); padding-top: 1rem; margin-top: 2rem; }
.dates dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 1rem; margin: 0; }
.dates dt { color: var(--ink-faint); font-size: 0.9rem; }
.dates dd { margin: 0; font-size: 0.95rem; }
.reflections { margin-top: 2rem; }
.reflection {
  border-left: 3px solid var(--line);
  padding: 0.1rem 0 0.1rem 1rem;
  margin: 1rem 0;
  white-space: pre-wrap;
}
.reflection .when { color: var(--ink-faint); font-size: 0.85rem; display: block; margin-bottom: 0.25rem; }
.connections { margin-top: 2rem; }
.connections h3, .reflections h3 { font-size: 1rem; margin: 0 0 0.4rem; }
.connections ul { list-style: none; padding: 0; margin: 0; }
.connections li { padding: 0.5rem 0; border-bottom: 1px solid var(--line); }
.basis { color: var(--ink-faint); font-size: 0.82rem; }

/* --- search / filters ------------------------------------------------- */
.search-row { display: flex; gap: 10px; margin-bottom: 0.6rem; flex-wrap: wrap; }
input[type="search"], input[type="text"] {
  font: inherit;
  padding: 0.6em 0.8em;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  color: var(--ink);
  flex: 1 1 18rem;
  min-width: 0;
}
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 0.6rem 0 1.4rem; }
.chip {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0.3em 0.8em;
  font-size: 0.9rem;
  cursor: pointer;
  background: none;
  color: var(--ink-soft);
  display: inline-flex;
  align-items: center;
  gap: 0.45em;
}
.chip[aria-pressed="true"] { background: var(--accent-soft); color: var(--ink); border-color: var(--accent); }
.histogram { display: flex; align-items: flex-end; gap: 3px; height: 90px; margin: 0.4rem 0 0.3rem; overflow-x: auto; }
.histogram .bar { flex: 0 0 18px; background: var(--accent-soft); border-radius: 3px 3px 0 0; position: relative; cursor: pointer; }
.histogram .bar[aria-pressed="true"] { background: var(--accent); }
.histogram .bar span { position: absolute; bottom: -1.3rem; left: 50%; transform: translateX(-50%) rotate(-45deg); font-size: 0.7rem; color: var(--ink-faint); }
.hist-wrap { padding-bottom: 1.6rem; }

/* --- constellation ---------------------------------------------------- */
#sky-wrap { position: relative; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; background: #0a0b10; }
#sky { display: block; width: 100%; height: 68vh; touch-action: none; cursor: grab; }
#sky.dragging { cursor: grabbing; }
.sky-controls { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; }
.sky-controls button { background: rgba(20,20,26,0.8); color: #e9e4d8; border-color: #3b3a42; }
.sky-legend { position: absolute; left: 10px; bottom: 10px; color: #b9b3a5; font-size: 0.8rem; }
.sky-tip {
  position: absolute;
  pointer-events: none;
  background: rgba(12,12,16,0.92);
  color: #efe9dc;
  border: 1px solid #43414a;
  border-radius: 8px;
  padding: 6px 9px;
  font-size: 0.85rem;
  max-width: 18rem;
  display: none;
}
.empty { color: var(--ink-faint); font-style: italic; padding: 2rem 0; }
footer.foot { border-top: 1px solid var(--line); margin-top: 3rem; padding-top: 1rem; color: var(--ink-faint); font-size: 0.85rem; }

@media print {
  header.bar, nav.tabs, .sky-controls, #sky-wrap, .chips, .search-row, .histogram { display: none !important; }
  body { background: #fff; color: #000; font-size: 11pt; }
  .wrap { max-width: none; padding: 0; }
  a { color: #000; text-decoration: none; }
}
`;

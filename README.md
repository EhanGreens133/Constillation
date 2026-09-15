# Constellation

A personal archive: somewhere to put thoughts, stories, feelings, quotes, songs
and lessons, so that the people who come after can understand who you were.

Two things follow from that purpose, and they decide every design choice here:

- **The artifact outlives the software.** `GET /api/export` produces a zip whose
  `archive.html` is one self-contained file — open it by double-clicking, with
  no server, no internet, no account and no install, on a machine that has
  never seen this application. The database is a convenience while you are
  alive. `archive.txt` is the copy most likely to still open in forty years.
- **Your words are the product.** Nothing automated ever edits, rewrites,
  summarises or normalises the body of an entry. Where the system contributed a
  title, a category or a connection, it is labelled as such and reversible
  without touching the text.

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
```

With no configuration at all, everything works: entries are stored as JSON
under `.data/`, search runs as an in-process lexical scan, relatedness uses
TF-IDF, and the suggestion pass proposes the opening words of each entry. Sign
in from `/login` — the magic link is printed to the server console and written
to `.data/magic-link.txt`.

Then, in rough order of value:

```bash
npm run check          # is the config complete, and does it actually work?
npm test               # the acceptance tests from the brief
npm run verify:viewer  # runs the exported viewer against a minimal DOM
npm run verify:export  # builds an export and reads it back out of the zip
npm run verify:suggest # drives the OpenAI path against a stub, spending nothing
npm run seed -- 600 --work
```

Copy `.env.example` to `.env` when you want Atlas, embeddings or a model.
`AUTH_SECRET` is required in production.

**Models.** Both model-backed features are OpenAI and both are optional:
`OPENAI_API_KEY` covers them. The naming pass uses the Responses API with
structured outputs (`SUGGEST_MODEL`, default `gpt-5` — any model with
structured-output support works). Embeddings use `text-embedding-3-small` by
default; `EMBEDDING_DIMENSIONS` must match the `numDimensions` of your Atlas
vector index. With no key at all, suggestions come from the extractive
(verbatim, no-model) path and relatedness from TF-IDF.

---

## What is where

```
src/app/                 pages and API routes
  page.tsx               capture: one text area, one button
  entries/               read: search, filters, year histogram, entry view
  stars/                 the constellation (canvas)
  naming/                the naming and filing pass
  clusters/ opening/ export/ handover/
  api/                   the endpoints listed below
src/lib/
  entries.ts             every write to an entry goes through here
  suggest.ts             proposals, and the guardrails that discard them
  related.ts             rethread: vectors, then TF-IDF
  layout.ts              force relaxation for the star view
  search.ts              Atlas Search, falling back to a lexical scan
  export/                the artifact: html, txt, json, readme, zip
  store/                 MongoDB, or local JSON when no URI is set
src/components/
  StarCanvas.tsx         canvas rendering, culling, LOD, drag-to-pin
scripts/                 tests, seeding, verification, benchmarks
```

## API

```
POST   /api/entries                  capture. body required, everything else optional
POST   /api/entries/sync             offline queue drain, idempotent per entry
PATCH  /api/entries/:id              edit. rejects changes to whenWritten
POST   /api/entries/:id/reflections  append a later thought
POST   /api/entries/:id/connections  connect two entries by hand (basis "author")
DELETE /api/entries/:id              soft delete
GET    /api/entries                  filter by cluster, year, private, unfiled, untitled
GET    /api/search?q=                Atlas Search, or the lexical fallback
GET    /api/facets                   counts, and the two year histograms
POST   /api/suggest                  takes entry ids, returns proposals, writes nothing
POST   /api/rethread                 recomputes related[] for all entries, then relayouts
POST   /api/layout                   re-runs the layout relaxation only
GET    /api/stars                    columnar payload for the canvas
GET    /api/export?edition=&format=  inheritance | working; zip | html | txt | json
CRUD   /api/clusters
GET|PUT /api/archive                 title and opening message
GET    /api/health                   which paths are live and what the fallback is
```

---

## The decisions worth knowing about

### Capture cannot fail

The save path is local-first: an entry is written to IndexedDB in the browser
before anything touches the network, then pushed to the server. A save cannot
fail for want of connectivity, and closing the tab loses nothing. A service
worker caches the app shell so the capture screen opens offline. Conflicts
resolve per entry by last write wins, using the timestamps the client recorded.

The embedding is computed after the write returns, never during it, and a
failed embedding never fails a save.

### Untitled and unfiled are permanent, valid states

Where a title is needed and there is none, the entry's own first ~58 characters
are shown verbatim, in italics. Nothing is fabricated, and "Untitled" appears
only when the body is genuinely empty. `clusterId: null` is not a backlog item.

### The suggestion guardrail is structural, not a matter of prompt tuning

The prompt tells the model to lift a phrase verbatim, never to add a judgement,
never to assign blame, and to return null rather than invent — but prompts are
not guarantees. So `validateProposal()` is the only way a proposal can reach
the UI, and it enforces:

- a title must be a **verbatim span of the body**, returned in the body's own
  spelling, starting and ending on word boundaries;
- a span that drops an immediately preceding negation ("I don't feel invisible
  at home" → "feel invisible at home") is refused, because it inverts meaning;
- a year is kept only if that four-digit year appears in the text;
- a category must be one of the nine kinds; a cluster must already exist;
- anything else becomes `null`, and a null title is a good outcome.

The failure the brief names is a test, not a hope:

```
body    "I sometimes feel invisible at home."
refused "My Family Never Understood Me"   - interprets, generalises, blames
allowed "I sometimes feel invisible at home", or any verbatim span, or null
```

`npm run test:suggest` runs that against twenty emotionally charged entries and
ten plausible-but-forbidden titles. With `OPENAI_API_KEY` set it also runs the
model path and holds every title it proposes to the same rule.

`npm run verify:suggest` goes further: it points the OpenAI SDK at a local
server that speaks the Responses API, so the real code path is exercised
without spending anything. It checks the request shape (structured outputs,
strict closed schema, the guardrail prompt as `instructions`), that a
well-formed reply parses, that a model returning `"My Family Never Understood
Me"` has it discarded *on that path*, and that a refusal, a truncated reply, a
schema-invalid reply and an API outage each degrade to something honest.

Two related choices: `POST /api/suggest` writes nothing, ever — the author
applies proposals one at a time, and anything applied is stored with
`*Source: "suggested"` and rendered with a visible marker. And a refusal is
surfaced plainly rather than retried against a different model: a fallback
model would have different naming behaviour, and this is not material to
quietly reroute.

### Relatedness is described honestly

Vectors where they exist (Atlas Vector Search, or the same cosine computed in
process), TF-IDF over the corpus otherwise, stored on the entry with a `basis`
so the export carries its own connections. Connections the author makes by hand
store as `basis: "author"`, always rank first, and survive a rethread.

The UI never says "Related". It says "shares words with" or "similar wording
and subject", because that is all the system did. Two entries about the same
person — one written in anger, one after reconciliation — score as close
neighbours, and the exported page tells the reader so in those words.

### Three dates, never collapsed

`whenHappened` (the year the thing occurred, usually null), `whenWritten` (set
once, at capture, and rejected by PATCH), and `reflections[].at` (later
thoughts, appended, never replacing). The difference between what someone
believed in 2011 and what they concluded in 2019 is exactly what a reader
needs.

### The year histogram counts writing, not significance

Labelled that way everywhere it appears, including in the exported page and the
README inside the export: pain generates writing, contentment often generates
none.

### Auth is single-user, and the gate is in the Node runtime

One account, one password:

```bash
npm run set-password      # asks twice, hidden; stores a scrypt hash, never the password
npm run login             # prints a sign-in link, for when the password is forgotten
```

The password is hashed with scrypt (N=16384, ~60ms per attempt) and only the
hash is written to `.env.local`. The hash uses `:` separators rather than the
conventional `$`, because Next.js runs `.env.local` through dotenv-expand and
`$16384` would be read as a variable reference and silently vanish — turning
every correct password into a wrong one with nothing in any log to explain it.
Sign-in failures are rate limited to ten per ten minutes.

`npm run login` is the way back in that cannot be locked out: it needs access
to the machine running the server, which the author has by definition. No
third party has to still be in business for you to sign in.

`src/middleware.ts` only routes: it checks that a session cookie is *present*
and redirects to `/login` if not. It does not verify the signature, because the
edge runtime inlines `process.env` at build time — a secret baked into the
bundle would mean that changing `AUTH_SECRET` without rebuilding locks the
author out of his own archive. `requireAuthor()` does the real verification in
every API route, in the Node runtime, reading the secret at request time.
`npm run smoke` proves it by running the server with a different secret than
the build used.

### The star view at 5,000 entries

Canvas, with viewport culling through a spatial grid (mandatory, not an
optimisation), level of detail (regions → points → labels), drawing only when
something changed, colour-batched draw calls, and inline coordinate transforms
so a frame allocates nothing per point. Positions are relaxed server-side
against the `related` graph and cached in `position`; opening the screen never
runs a layout. Dragging a star sets `position.pinned`, and pinned stars survive
every future relax.

Measured on this machine at 5,000 entries (`npm run bench:layout`):

| | |
|---|---|
| layout relaxation | 120 iterations, 0.52s |
| whole archive in one viewport | 3,666 points, 1.08ms cull+transform per frame |
| zoomed in 4× | 1,666 points, 0.08ms per frame |
| search | 27ms |
| rethread (TF-IDF, on demand) | 5.8s |
| export | 0.4MB zip, 4.4MB `archive.html`, 0.4s |

The 30fps budget is 33ms per frame.

### Everything degrades rather than breaks

| Missing | What happens |
|---|---|
| `MONGODB_URI` | local JSON store under `.data/` |
| Atlas Search index | in-process lexical scan, narrowed server-side by regex |
| Atlas Vector index | the same cosine computed in process |
| embedding provider | TF-IDF relatedness, `basis: "lexical"` |
| `OPENAI_API_KEY` | extractive suggestions: the opening words, verbatim |
| network, entirely | capture queues locally; the export still opens |

`GET /api/health` reports which path is currently live. If `MONGODB_URI` *is*
set, an unreachable Atlas surfaces as a failed write that the browser queue
holds onto — it never silently falls back to local files, because that would
split the archive in two.

---

## Export

```bash
npm run export                  # inheritance edition -> ./exports
npm run export -- working ./backups
npm run verify:export
```

The zip contains, with a build timestamp:

- **`archive.html`** — the viewer and the whole archive in one file. The data is
  embedded as JSON in a `<script type="application/json">` tag with `<`
  escaped. No fetch calls, no CDN, no network fonts, no `<script src>`. Opening
  message first, then timeline, collections, search, a constellation, and an
  "About this archive" page written for someone who has never used software
  like this. There is a `<noscript>` fallback pointing at the text file.
- **`archive.txt`** — plain UTF-8, chronological, grouped by year, with titles,
  bodies, attributions and later notes. Entry bodies sit flush left and are
  byte-identical to what was written; only the metadata around them is
  indented, so not even line wrapping touches the author's text.
- **`archive.json`** — the structured data, documenting its own schema field by
  field, including what each `*Source` value means.
- **`README.txt`** — plain language, for a non-technical reader: what this is,
  how to open it, and that the text file is the fallback if the page ever stops
  working.

Editions: **inheritance** is everything except `private` entries, with
`embedding` stripped and `related` filtered to surviving entries so no
connection is a dead end. **Working copy** is everything.

An audio recording of the opening message is base64-embedded in `archive.html`
*and* written alongside as a playable file.

### Verify it properly

`npm run verify:export` reads the zip back through its central directory,
checks every CRC, and proves the HTML has no network references and that no
private entry's id or unique text is in it. `npm run verify:viewer` pulls the
viewer's JavaScript out of `archive.html`, gives it the embedded JSON and a
minimal DOM, and drives it the way a reader would: open it, read the opening
message, open an entry, follow a connection, search for a word.

Neither can prove the machine you open it on is actually offline. Do that part
by hand, once: USB stick, another machine, networking off, double-click.

---

## Deploying on Azure

```bash
NEXT_OUTPUT=standalone npm run build
```

App Service or Container Apps both work; `mongodb` is already in
`serverExternalPackages`. Set `AUTH_SECRET`, `APP_ORIGIN`, `MONGODB_URI` and,
if you want them, the Atlas index names and the embedding and model keys. Then
`npm run indexes` once, which creates the four ordinary indexes and attempts
the two Atlas Search indexes (reported as skipped on a plain mongod — not a
failure).

A monthly `npm run export` into a backup location costs nothing and is the
cheapest insurance there is.

---

## Deliberately not built

Social features, sharing links, comments, collaboration. Streaks, reminders,
prompts of the day, gamification. "On this day", anniversary notifications,
random excerpts — the archive contains difficult material and is opened
deliberately or not at all. Sentiment analysis, mood scoring, inferred
psychological attributes. AI-generated summaries of the person: the reader
should meet him, not a description of him. Any read path that needs the model
API to be reachable.

And no dead man's switch. An offline file cannot know its author has died, a
date check in client-side JavaScript is bypassed with the developer tools or
the system clock, and anything server-enforced depends on a company still
existing — the exact failure this archive is built to avoid. `/handover` says
so on the page, and offers the honest alternative: an encrypted copy whose key
is held by a named person under written instructions, with a plain statement
that this depends entirely on that person's judgement.

What `/handover` does instead is the ordinary thing that actually works: name a
primary and a backup custodian, download a dated inheritance edition for each,
hand it over with a note, and confirm they have opened it on their own device.

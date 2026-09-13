/**
 * Drives the running application over HTTP: the auth boundary, capture, the
 * offline sync endpoint, search, suggestions, clusters, export and the star
 * payload.
 *
 *   npm run build && npm start          (in one terminal)
 *   npm run smoke                       (in another)
 *
 * AUTH_SECRET must match the server's, because this mints its own session
 * cookie rather than going through the magic link.
 */

import { check, eq, info, section, summary } from "./lib/harness";
import { SESSION_COOKIE, createSessionToken } from "../src/lib/auth";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const cookie = `${SESSION_COOKIE}=${createSessionToken()}`;

const asAuthor = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  redirect: "manual",
});

async function json<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, asAuthor(init));
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON: keep the text */
  }
  return { status: res.status, body: body as T };
}

section(`Reaching ${base}`);
try {
  const health = await fetch(`${base}/api/health`);
  const body = (await health.json()) as { ok: boolean; storage: { backend: string; entries: number } };
  check("the server answers /api/health without a session", health.ok);
  info(`storage: ${body.storage.backend}, ${body.storage.entries} entries`);
} catch (err) {
  console.log(`\nCould not reach ${base}: ${(err as Error).message}`);
  console.log("Start the server first: npm run build && npm start");
  process.exit(1);
}

section("The auth boundary");
const anonPage = await fetch(base, { redirect: "manual" });
check("an unauthenticated page request is redirected to /login", anonPage.status === 307 || anonPage.status === 302);
info(`-> ${anonPage.headers.get("location")}`);
const anonApi = await fetch(`${base}/api/entries`, { redirect: "manual" });
eq("an unauthenticated API request is refused", anonApi.status, 401);
const badCookie = await fetch(`${base}/api/entries`, {
  headers: { cookie: `${SESSION_COOKIE}=not.a.real.token` },
  redirect: "manual",
});
eq("a forged session cookie is refused", badCookie.status, 401);

section("Capture");
const unique = `smoke-${Date.now()}`;
const created = await json<{ entry: { _id: string; title: string; clusterId: null; whenWritten: string } }>(
  "/api/entries",
  { method: "POST", body: JSON.stringify({ body: `${unique} A thing I wrote down, with no title and no category.` }) },
);
eq("POST /api/entries accepts a body alone", created.status, 201);
const id = created.body.entry._id;
eq("it comes back untitled", created.body.entry.title, "");
eq("and unfiled", created.body.entry.clusterId, null);
check("whenWritten was set by the server", !!created.body.entry.whenWritten);

const noBody = await json<{ error: string }>("/api/entries", { method: "POST", body: JSON.stringify({}) });
eq("a missing body is refused", noBody.status, 400);

section("Offline sync");
const offlineId = Array.from({ length: 24 }, (_, i) => "0123456789abcdef"[(i * 7) % 16]).join("");
const syncBody = {
  entries: [
    {
      id: offlineId,
      body: `${unique} captured while offline`,
      private: false,
      capturedAt: new Date(Date.now() - 3600_000).toISOString(),
      updatedAt: new Date(Date.now() - 3600_000).toISOString(),
    },
  ],
};
const synced = await json<{ saved: string[]; failed: unknown[] }>("/api/entries/sync", {
  method: "POST",
  body: JSON.stringify(syncBody),
});
eq("the queued entry syncs", synced.body.saved.length, 1);
eq("it keeps the id it was given offline", synced.body.saved[0], offlineId);
const resynced = await json<{ saved: string[] }>("/api/entries/sync", { method: "POST", body: JSON.stringify(syncBody) });
eq("re-sending the same entry is idempotent", resynced.body.saved.length, 1);
const total = await json<{ total: number }>("/api/entries?limit=1");
info(`${total.body.total} entries in the archive`);

section("Edit rules over HTTP");
const patchWhen = await json<{ error: string }>(`/api/entries/${id}`, {
  method: "PATCH",
  body: JSON.stringify({ whenWritten: new Date().toISOString() }),
});
eq("PATCH rejects whenWritten", patchWhen.status, 400);
const patchTitle = await json<{ entry: { title: string; titleSource: string } }>(`/api/entries/${id}`, {
  method: "PATCH",
  body: JSON.stringify({ title: "A thing I wrote down", source: "suggested" }),
});
eq("a suggested title is stored as suggested", patchTitle.body.entry.titleSource, "suggested");
const reflection = await json<{ entry: { reflections: unknown[] } }>(`/api/entries/${id}/reflections`, {
  method: "POST",
  body: JSON.stringify({ text: "Still true, years later." }),
});
eq("a reflection is appended", reflection.body.entry.reflections.length, 1);

section("Search and suggestions");
const search = await json<{ hits: unknown[]; engine: string; tookMs: number }>(`/api/search?q=${unique}`);
check("search finds what was just captured", search.body.hits.length >= 2, JSON.stringify(search.body.hits.length));
info(`engine ${search.body.engine}, ${search.body.tookMs}ms`);

const before = await json<{ entry: { title: string; kind: string } }>(`/api/entries/${offlineId}`);
const suggest = await json<{ proposals: { entryId: string; title: string | null }[]; wrote: string }>("/api/suggest", {
  method: "POST",
  body: JSON.stringify({ entryIds: [offlineId] }),
});
eq("POST /api/suggest returns proposals", suggest.status, 200);
eq("and says so explicitly: it wrote nothing", suggest.body.wrote, "nothing");
const after = await json<{ entry: { title: string; kind: string } }>(`/api/entries/${offlineId}`);
eq("the entry is unchanged", JSON.stringify(after.body.entry), JSON.stringify(before.body.entry));

section("Clusters");
const cluster = await json<{ cluster: { _id: string; name: string } }>("/api/clusters", {
  method: "POST",
  body: JSON.stringify({ name: `Smoke ${Date.now()}` }),
});
eq("a cluster is created", cluster.status, 201);
await json(`/api/entries/${id}`, { method: "PATCH", body: JSON.stringify({ clusterId: cluster.body.cluster._id }) });
const deleted = await json<{ unfiled: number }>(`/api/clusters/${cluster.body.cluster._id}`, { method: "DELETE" });
eq("deleting it unfiles its entry", deleted.body.unfiled, 1);
const stillThere = await json<{ entry: { clusterId: null } }>(`/api/entries/${id}`);
eq("the entry survived, unfiled", stillThere.body.entry.clusterId, null);

section("Star payload");
const stars = await json<{ count: number; ids: string[]; x: number[]; edges: number[]; titles: string[] }>("/api/stars");
eq("the payload is columnar", Array.isArray(stars.body.x) && Array.isArray(stars.body.ids), true);
eq("one position per entry", stars.body.x.length, stars.body.count);
eq("one title per entry", stars.body.titles.length, stars.body.count);
check("edges come as flat triples", stars.body.edges.length % 3 === 0);
info(`${stars.body.count} stars, ${stars.body.edges.length / 3} edges`);

section("Export over HTTP");
for (const [format, type] of [
  ["zip", "application/zip"],
  ["html", "text/html"],
  ["txt", "text/plain"],
  ["json", "application/json"],
] as const) {
  const res = await fetch(`${base}/api/export?edition=inheritance&format=${format}`, asAuthor());
  const bytes = (await res.arrayBuffer()).byteLength;
  check(
    `format=${format} downloads as ${type} (${(bytes / 1024).toFixed(0)}KB)`,
    res.ok && (res.headers.get("content-type") ?? "").startsWith(type) && bytes > 200,
  );
  check(
    `format=${format} is sent as an attachment`,
    (res.headers.get("content-disposition") ?? "").includes("attachment"),
  );
}
const badFormat = await json<{ error: string }>("/api/export?format=pdf");
eq("an unknown format is refused", badFormat.status, 400);

section("Soft delete over HTTP");
const removed = await json<{ ok: boolean; note: string }>(`/api/entries/${id}`, { method: "DELETE" });
check("DELETE soft deletes and says so", removed.body.ok && /soft deleted/.test(removed.body.note));
const gone = await json(`/api/entries/${id}`);
eq("the entry is no longer served", gone.status, 404);

summary();

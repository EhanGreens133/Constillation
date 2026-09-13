/*
 * Service worker: keeps the capture screen openable with no connectivity.
 *
 * It caches the application shell and its static chunks. It never caches API
 * responses - reading stale entries would be worse than saying "offline" -
 * and it never interferes with writes, which are queued in IndexedDB by the
 * page itself and synced later.
 */

const VERSION = "constellation-v1";
const SHELL = [ "/", "/entries", "/manifest.webmanifest" ];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API: always live. An archive must never show a stale version of itself.
  if (url.pathname.startsWith("/api/")) return;

  // Build assets are immutable: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: try the network, fall back to whatever we have, then to the
  // capture screen - which works offline by design.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
  );
});

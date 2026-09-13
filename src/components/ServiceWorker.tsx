"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that keeps the capture screen loadable with no
 * connectivity. Without it, an offline queue would be useless: the page
 * itself would not open.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol === "http:" && window.location.hostname !== "localhost") return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[sw] registration failed:", err?.message ?? err);
    });
  }, []);
  return null;
}

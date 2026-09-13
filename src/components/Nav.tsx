"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { flush, pendingCount } from "@/lib/client/queue";

const LINKS: [string, string][] = [
  ["/", "Write"],
  ["/entries", "Read"],
  ["/stars", "Constellation"],
  ["/naming", "Name & file"],
  ["/clusters", "Collections"],
  ["/opening", "Opening message"],
  ["/export", "Export"],
  ["/handover", "Handover"],
];

export function Nav() {
  const pathname = usePathname();
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const n = await pendingCount();
      if (alive) setQueued(n);
    };
    const onOnline = async () => {
      setOnline(true);
      await flush();
      await refresh();
    };
    const onOffline = () => setOnline(false);

    setOnline(navigator.onLine);
    void refresh();
    void flush().then(refresh);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const timer = window.setInterval(refresh, 5000);
    return () => {
      alive = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(timer);
    };
  }, []);

  if (pathname?.startsWith("/login")) return null;

  return (
    <header className="top">
      <div className="top-inner">
        <Link href="/" className="brand">
          Constellation
          {queued > 0 ? (
            <small title="Captured on this device and not yet on the server. Nothing is lost.">
              {queued} waiting to sync
            </small>
          ) : !online ? (
            <small>offline - capture still works</small>
          ) : null}
        </Link>
        <nav className="main">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

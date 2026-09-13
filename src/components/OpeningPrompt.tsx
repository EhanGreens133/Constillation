"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ArchiveDTO } from "@/lib/types";

/**
 * The one thing this application will keep asking for.
 *
 * The opening message is the only place the author addresses the reader
 * directly rather than being read sideways through fragments, which makes it
 * the highest-value content in the archive. It is never a blocker, and it
 * never nags about anything else.
 */
export function OpeningPrompt() {
  const [archive, setArchive] = useState<ArchiveDTO | null>(null);

  useEffect(() => {
    api
      .get<{ archive: ArchiveDTO }>("/api/archive")
      .then((r) => setArchive(r.archive))
      .catch(() => setArchive(null));
  }, []);

  if (!archive || archive.opening.trim()) return null;

  return (
    <div className="offline-banner" style={{ marginTop: "1.6rem" }}>
      <strong>There is no opening message yet.</strong>{" "}
      Every exported copy of this archive opens with it, before anything else. It is the only place you speak to whoever
      is reading directly. <Link href="/opening">Write it now</Link> — a few sentences is enough.
    </div>
  );
}

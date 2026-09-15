/**
 * When this process last changed searchable text.
 *
 * Atlas Search is eventually consistent: a document is not searchable the
 * instant it is written. That is normally invisible, but it is exactly wrong
 * in the one moment that matters most here - the author writes something
 * down, searches for it, and is told it does not exist.
 *
 * So search treats an empty Atlas result as authoritative only when nothing
 * has been written recently. Just after a capture it double-checks against
 * the database itself. One boolean, no extra query.
 */

let lastWriteAt = 0;

export function noteWrite(): void {
  lastWriteAt = Date.now();
}

export function wroteRecently(withinMs = 60_000): boolean {
  return lastWriteAt > 0 && Date.now() - lastWriteAt < withinMs;
}

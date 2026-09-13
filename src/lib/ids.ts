import { randomBytes } from "node:crypto";

/**
 * ObjectId-compatible 24-char hex ids, generated without a database round
 * trip. Layout matches Mongo's: 4-byte seconds, 5-byte random-per-process,
 * 3-byte counter. That makes them monotonic enough that sorting by `_id`
 * matches insertion order in both storage backends.
 */

const PROCESS_RANDOM = randomBytes(5);
let counter = randomBytes(3).readUIntBE(0, 3);

export function newId(): string {
  const buf = Buffer.alloc(12);
  buf.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
  PROCESS_RANDOM.copy(buf, 4);
  counter = (counter + 1) % 0xffffff;
  buf.writeUIntBE(counter, 9, 3);
  return buf.toString("hex");
}

export function isId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v);
}

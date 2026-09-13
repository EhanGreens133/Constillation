import { inflateRawSync } from "node:zlib";
import { crc32 } from "../../src/lib/export/zip";

/**
 * Reads the zip back the way an archive reader would: from the central
 * directory, checking every CRC. Used by the export verification so the test
 * exercises the file rather than the code that produced it.
 */

export interface Unzipped {
  name: string;
  data: Buffer;
  crcOk: boolean;
}

export function unzip(buf: Buffer): Unzipped[] {
  // End of central directory: scan backwards for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip file: no end-of-central-directory record");

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const out: Unzipped[] = [];

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = buf.readUInt16LE(offset + 10);
    const crc = buf.readUInt32LE(offset + 16);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);

    out.push({ name, data, crcOk: crc32(data) === crc });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

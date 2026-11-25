/**
 * A photo without what the camera wrote about it: place, time, device, owner. Neither the manager who checks a certificate
 * nor whoever sees a profile picture has any need of where the person lives. Android's picker copies all of that into the compressed photo it hands over (`copyExifData`), but not the rotation: the
 * pixels are already the right way up, so nothing is lost by leaving it out. The pixels are not touched.
 */

const at = (b: Uint8Array, i: number, ...bytes: number[]) => bytes.every((v, k) => b[i + k] === v);

/** JPEG segments that describe the picture itself: JFIF, the ICC colour profile, Adobe's colour transform. */
const KEEP = new Set([0xe0, 0xe2, 0xee]);
/** PNG chunks that say something about the person or the phone. */
const DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

function stripJpeg(b: Uint8Array): Uint8Array | null {
  const parts = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xda) return join([...parts, b.subarray(i)]); // the pixels start here
    const end = i + 2 + (b[i + 2] << 8) + b[i + 3];
    if (end < i + 4 || end > b.length) return null;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (marker !== 0xfe && (!isApp || KEEP.has(marker))) parts.push(b.subarray(i, end));
    i = end;
  }
  return null;
}

function stripPng(b: Uint8Array): Uint8Array | null {
  const parts = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const end = i + 12 + ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
    if (end < i + 12 || end > b.length) return null;
    if (!DROP.has(type)) parts.push(b.subarray(i, end));
    if (type === "IEND") return join(parts);
    i = end;
  }
  return null;
}

/** The photo's bytes without its metadata, or null when they are not a whole JPEG or PNG (then it must not be sent). */
export function stripMetadata(b: Uint8Array): Uint8Array | null {
  if (at(b, 0, 0xff, 0xd8, 0xff)) return stripJpeg(b);
  if (at(b, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return stripPng(b);
  return null;
}

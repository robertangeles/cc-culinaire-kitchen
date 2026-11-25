/**
 * A photo without what the camera wrote about it: place, time, device, owner. Neither the manager who checks a certificate
 * nor whoever sees a profile picture has any need of where the person lives. Android's picker copies all of that into the compressed photo it hands over (`copyExifData`), but not the rotation: the
 * pixels are already the right way up. On an iPhone the camera and cropped paths rotate the pixels, but the photo library path keeps the rotation only in the Orientation tag
 * (expo-image-picker `MediaHandler.swift`, PHPicker path, no `fixOrientation`), so that one tag is written back alone, in a new EXIF segment. This could not be checked on an iPhone or iPad (no Mac);
 * if the picker already bakes the rotation into the pixels the tag is 1 or absent and nothing changes. The pixels are not touched.
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

/** The EXIF Orientation (1 to 8) of an APP1 segment body, or null when there is none or the segment is not whole. */
function orientation(b: Uint8Array, start: number, end: number): number | null {
  if (!at(b, start, 0x45, 0x78, 0x69, 0x66, 0, 0)) return null; // "Exif\0\0"
  const tiff = start + 6;
  const little = at(b, tiff, 0x49, 0x49, 0x2a, 0);
  if (!little && !at(b, tiff, 0x4d, 0x4d, 0, 0x2a)) return null;
  const u16 = (i: number) => (little ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  const u32 = (i: number) => (little ? u16(i) + u16(i + 2) * 65536 : u16(i) * 65536 + u16(i + 2));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  for (let e = ifd + 2, last = e + 12 * u16(ifd); e + 12 <= last && last <= end; e += 12) {
    if (u16(e) !== 0x0112) continue;
    const value = u16(e + 8);
    return u16(e + 2) === 3 && u32(e + 4) === 1 && value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

/** An EXIF segment holding the Orientation tag and nothing else. */
const exifOf = (value: number) =>
  new Uint8Array([0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, value, 0, 0, 0, 0, 0, 0]);

function stripJpeg(b: Uint8Array): Uint8Array | null {
  const parts = [b.subarray(0, 2)];
  let i = 2;
  let seen = false;
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
    if (marker === 0xe1 && !seen) {
      const turned = orientation(b, i + 4, end);
      if (turned) {
        seen = true;
        parts.push(exifOf(turned));
      }
    }
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

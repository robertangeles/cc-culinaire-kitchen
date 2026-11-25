import { describe, it, expect } from "vitest";
import { stripMetadata } from "./photoMetadata";

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
const PIXELS = [...seg(0xda, [1, 2, 3]), 0x10, 0xff, 0x00, 0x20, 0xff, 0xd9];
const jpeg = (...segments: number[][]) => new Uint8Array([0xff, 0xd8, ...segments.flat(), ...PIXELS]);
const text = (b: Uint8Array | null) => String.fromCharCode(...(b ?? []));

const JFIF = seg(0xe0, ascii("JFIF\0"));
const EXIF = seg(0xe1, ascii("Exif\0\0GPS-37.81,144.96"));
const XMP = seg(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0home"));
const ICC = seg(0xe2, ascii("ICC_PROFILE\0"));
const IPTC = seg(0xed, ascii("Photoshop 3.0\0by Sam"));
const COMMENT = seg(0xfe, ascii("taken at home"));
const TABLE = seg(0xdb, [9, 9]);

describe("a JPEG without its metadata", () => {
  it("drops place, time, device, author and comments, and keeps the picture byte for byte", () => {
    const out = stripMetadata(jpeg(JFIF, EXIF, XMP, ICC, IPTC, COMMENT, TABLE));
    expect([...out!]).toEqual([...jpeg(JFIF, ICC, TABLE)]);
    expect(text(out)).not.toMatch(/GPS|home|Sam/);
  });

  it("leaves a photo with none as it is", () => {
    expect([...stripMetadata(jpeg(JFIF, TABLE))!]).toEqual([...jpeg(JFIF, TABLE)]);
  });

  it("refuses one that is cut short or not a JPEG inside, instead of sending it as it came", () => {
    expect(stripMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 1, 2]))).toBeNull();
    expect(stripMetadata(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(stripMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xda]))).toBeNull();
    expect(stripMetadata(new Uint8Array(ascii("%PDF-1.7 and more")))).toBeNull();
  });
});

describe("a PNG without its metadata", () => {
  const chunk = (type: string, body: number[]) => [0, 0, 0, body.length, ...ascii(type), ...body, 1, 2, 3, 4];
  const png = (...chunks: number[][]) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunks.flat()]);
  const HEAD = chunk("IHDR", [5]);
  const DATA = chunk("IDAT", [7, 7]);
  const END = chunk("IEND", []);

  it("drops its text, EXIF and time, keeps the picture, and cuts anything hidden after the end", () => {
    const out = stripMetadata(new Uint8Array([...png(HEAD, chunk("tEXt", ascii("GPS")), chunk("eXIf", [1]), chunk("tIME", [1]), DATA, END), ...ascii("secret")]));
    expect([...out!]).toEqual([...png(HEAD, DATA, END)]);
  });

  it("refuses one that is cut short", () => {
    expect(stripMetadata(png(HEAD, DATA))).toBeNull();
    expect(stripMetadata(png([0x7f, 0xff, 0xff, 0xff, ...ascii("IDAT"), 0, 0, 0, 0]))).toBeNull();
  });
});

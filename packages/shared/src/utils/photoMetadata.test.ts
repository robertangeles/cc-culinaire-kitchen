import { describe, it, expect } from "vitest";
import { stripMetadata } from "./photoMetadata.js";

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

describe("a JPEG's orientation", () => {
  const u16 = (little: boolean, v: number) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (little: boolean, v: number) => (little ? [...u16(true, v & 0xffff), ...u16(true, v >> 16)] : [...u16(false, v >> 16), ...u16(false, v & 0xffff)]);
  const entry = (le: boolean, tag: number, type: number, count: number, value: number[]) => [...u16(le, tag), ...u16(le, type), ...u32(le, count), ...value];
  /** An EXIF segment laid out by the TIFF spec: byte order mark, 42, offset of the first directory, its entries, the end. */
  const exif = (le: boolean, entries: number[][], extra: number[] = []) =>
    seg(0xe1, [...ascii("Exif\0\0"), ...(le ? ascii("II") : ascii("MM")), ...u16(le, 42), ...u32(le, 8), ...u16(le, entries.length), ...entries.flat(), ...u32(le, 0), ...extra]);
  const turn = (le: boolean, v: number) => entry(le, 0x0112, 3, 1, [...u16(le, v), 0, 0]);
  const gps = (le: boolean) => entry(le, 0x8825, 4, 1, u32(le, 200));
  const make = (le: boolean) => entry(le, 0x010f, 2, 6, u32(le, 300));
  /** What a reader of the TIFF layout finds in the output: the Orientation, and how many tags there are. */
  const read = (out: Uint8Array | null) => {
    const b = out!;
    let i = 2;
    while (b[i + 1] !== 0xe1) i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    const le = b[i + 10] === 0x49;
    const rd = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
    return { length: 2 + ((b[i + 2] << 8) | b[i + 3]), tags: rd(i + 18), tag: rd(i + 20), value: rd(i + 28) };
  };

  it.each([true, false])("keeps the rotation alone, and nothing else the camera wrote (little-endian: %s)", (le) => {
    const out = stripMetadata(jpeg(JFIF, exif(le, [make(le), turn(le, 6), gps(le)], ascii("GPS-37.81,144.96")), TABLE));
    expect(read(out)).toEqual({ length: 36, tags: 1, tag: 0x0112, value: 6 });
    expect(text(out)).not.toMatch(/GPS|37|144/);
    expect(out!.length).toBe(jpeg(JFIF, TABLE).length + 36);
  });

  it("keeps the same segment whichever way the camera wrote its numbers", () => {
    expect([...stripMetadata(jpeg(exif(true, [turn(true, 8)])))!]).toEqual([...stripMetadata(jpeg(exif(false, [turn(false, 8)])))!]);
  });

  it("writes nothing when the camera wrote no rotation", () => {
    expect([...stripMetadata(jpeg(JFIF, exif(true, [make(true), gps(true)]), TABLE))!]).toEqual([...jpeg(JFIF, TABLE)]);
    expect([...stripMetadata(jpeg(JFIF, EXIF, TABLE))!]).toEqual([...jpeg(JFIF, TABLE)]);
  });

  it("drops a segment that cannot be trusted, and does not stop the photo", () => {
    const bad = [
      exif(true, [turn(true, 0)]),
      exif(true, [turn(true, 9)]),
      exif(true, [entry(true, 0x0112, 4, 1, [6, 0, 0, 0])]),
      exif(true, [entry(true, 0x0112, 3, 2, [6, 0, 0, 0])]),
      seg(0xe1, exif(true, [turn(true, 6)]).slice(4, -12)),
      seg(0xe1, [...ascii("Exif\0\0"), ...ascii("XX"), 0, 42, 0, 0, 0, 8, 0, 1]),
      seg(0xe1, [...ascii("Exif\0\0"), ...ascii("II"), 42, 0, 0xff, 0xff, 0xff, 0x7f, 0, 1]),
      seg(0xe1, [...ascii("Exif\0\0"), ...ascii("MM"), 0, 42, 0, 0, 0, 8, 0xff, 0xff, 1, 0x12]),
    ];
    for (const segment of bad) expect([...stripMetadata(jpeg(JFIF, segment, TABLE))!]).toEqual([...jpeg(JFIF, TABLE)]);
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

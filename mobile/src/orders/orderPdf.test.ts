import { describe, it, expect, vi, beforeEach } from "vitest";

const disk = vi.hoisted(() => ({ files: new Map<string, number>(), dir: false, failWrite: false, failDelete: false, os: "android" }));
vi.mock("react-native", () => ({ Platform: { get OS() { return disk.os; } } }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "cache" },
  Directory: class {
    constructor(...at: string[]) { expect(at).toEqual(["cache", "purchase-orders"]); }
    get exists() { return disk.dir; }
    create() { disk.dir = true; }
    delete() { if (disk.failDelete) throw new Error("busy"); disk.dir = false; disk.files.clear(); }
  },
  File: class {
    uri: string;
    constructor(_dir: unknown, name: string) { this.uri = `file:///cache/purchase-orders/${name}`; }
    async write(bytes: ArrayBuffer) { if (disk.failWrite) throw new Error("full"); disk.files.set(this.uri, bytes.byteLength); }
  },
}));
const share = vi.hoisted(() => vi.fn(async (_uri: string, _opts: object) => {}));
vi.mock("expo-sharing", () => ({ shareAsync: share }));

// React Native's FileReader, which is how the app reads a Blob's bytes (its Blob has no arrayBuffer()); node has none.
vi.stubGlobal("FileReader", class {
  result: ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then((b) => { this.result = b; this.onload?.(); }); }
});

import { clearOrderPdfs, shareOrderPdf } from "./orderPdf";

const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" });
beforeEach(() => {
  Object.assign(disk, { dir: false, failWrite: false, failDelete: false, os: "android" });
  disk.files.clear();
  share.mockClear();
});

describe("sharing an order's PDF", () => {
  it("writes the PDF to the cache under the order number and opens the share sheet on it", async () => {
    await shareOrderPdf(pdf, "PO-2026/0042");
    const uri = "file:///cache/purchase-orders/PO-2026_0042.pdf";
    expect(share).toHaveBeenCalledWith(uri, expect.objectContaining({ mimeType: "application/pdf", UTI: "com.adobe.pdf" }));
    // Android: the app it went to may still be reading it.
    expect(disk.files.get(uri)).toBe(4);
  });

  it("deletes the last one before the next share, so one PDF at most is ever left", async () => {
    await shareOrderPdf(pdf, "PO-1");
    await shareOrderPdf(pdf, "PO-2");
    expect([...disk.files.keys()]).toEqual(["file:///cache/purchase-orders/PO-2.pdf"]);
  });

  it("on iOS deletes it as soon as the sheet closes, or when sharing failed", async () => {
    disk.os = "ios";
    await shareOrderPdf(pdf, "PO-1");
    expect(disk.dir).toBe(false);
    share.mockRejectedValueOnce(new Error("no sheet"));
    await expect(shareOrderPdf(pdf, "PO-1")).rejects.toThrow("no sheet");
    expect(disk.files.size).toBe(0);
  });

  it("does not open the sheet on a file that could not be written", async () => {
    disk.failWrite = true;
    await expect(shareOrderPdf(pdf, "PO-1")).rejects.toThrow("full");
    expect(share).not.toHaveBeenCalled();
  });

  it("clearing never throws", () => {
    disk.dir = true;
    disk.failDelete = true;
    expect(clearOrderPdfs).not.toThrow();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const disk = vi.hoisted(() => ({ bytes: null as Uint8Array | null, exists: true, deleted: 0, failDelete: false }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "cache" },
  File: class { async bytes() { if (!disk.bytes) throw new Error("gone"); return disk.bytes; } },
  Directory: class { constructor(...at: string[]) { expect(at).toEqual(["cache", "ImagePicker"]); } get exists() { return disk.exists; } delete() { if (disk.failDelete) throw new Error("busy"); disk.deleted++; } },
}));

import { clearPickedPhotos, takePhoto } from "./photoFiles";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 3, 1, 0xff, 0xda, 0, 2, 7]);
beforeEach(() => Object.assign(disk, { bytes: JPEG, exists: true, deleted: 0, failDelete: false }));

describe("a picked photo", () => {
  it("comes back cleaned, with nothing of it left in the picker's cache", async () => {
    const photo = await takePhoto("file:///x.webp");
    expect([photo?.mimeType, ...photo!.bytes]).toEqual(["image/jpeg", 0xff, 0xd8, 0xff, 0xda, 0, 2, 7]);
    expect(disk.deleted).toBe(1);
  });

  it("is deleted too when it cannot be cleaned or read", async () => {
    disk.bytes = new Uint8Array([1, 2, 3]);
    expect(await takePhoto("file:///x.jpg")).toBeNull();
    disk.bytes = null;
    await expect(takePhoto("file:///x.jpg")).rejects.toThrow("gone");
    expect(disk.deleted).toBe(2);
  });

  it("clearing never throws", () => {
    disk.failDelete = true;
    expect(clearPickedPhotos).not.toThrow();
    disk.exists = false;
    disk.failDelete = false;
    clearPickedPhotos();
    expect(disk.deleted).toBe(0);
  });
});

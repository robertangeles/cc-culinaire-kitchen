import { describe, it, expect, vi, beforeEach } from "vitest";

const picker = vi.hoisted(() => ({ os: "ios", uri: "file:///tmp/app-Inbox/sales.csv", name: "sales.csv", size: 12 as number | null, cancel: false, unreadable: false, deleted: 0, mimeTypes: [] as string[] }));
vi.mock("react-native", () => ({ Platform: { get OS() { return picker.os; } } }));
vi.mock("expo-file-system", () => ({
  File: {
    async pickFileAsync(options: { mimeTypes: string[] }) {
      picker.mimeTypes = options.mimeTypes;
      if (picker.cancel) return { canceled: true, result: null };
      return {
        canceled: false,
        result: {
          uri: picker.uri,
          name: picker.name,
          size: picker.size,
          async bytes() { if (picker.unreadable) throw new Error("gone"); return new TextEncoder().encode("Margherita,2\n"); },
          delete() { picker.deleted++; },
        },
      };
    },
  },
}));

import { CSV_MAX_BYTES, pickCsv } from "./pickCsv";

beforeEach(() => Object.assign(picker, { os: "ios", uri: "file:///tmp/app-Inbox/sales.csv", name: "sales.csv", size: 12, cancel: false, unreadable: false, deleted: 0 }));

describe("picking a sales CSV", () => {
  it("reads the file into memory and deletes the copy iOS made of it", async () => {
    const got = await pickCsv();
    expect(got.kind === "picked" && [got.csv.name, new TextDecoder().decode(got.csv.bytes)]).toEqual(["sales.csv", "Margherita,2\n"]);
    expect(picker.mimeTypes).toContain("text/csv");
    expect(picker.deleted).toBe(1);
  });

  it("never deletes the person's own file on Android", async () => {
    Object.assign(picker, { os: "android", uri: "content://com.android.providers.downloads.documents/document/42" });
    expect((await pickCsv()).kind).toBe("picked");
    expect(picker.deleted).toBe(0);
  });

  it("takes a file whose Android content link has no .csv name, and refuses one over the server's limit or one it cannot read, deleting the copy each time", async () => {
    Object.assign(picker, { name: "msf:42" });
    expect((await pickCsv()).kind).toBe("picked");
    Object.assign(picker, { name: "SALES.CSV", size: CSV_MAX_BYTES + 1 });
    expect(await pickCsv()).toMatchObject({ kind: "refused", reason: expect.stringContaining("over 5 MB") });
    Object.assign(picker, { size: null, unreadable: true });
    expect(await pickCsv()).toMatchObject({ kind: "refused", reason: expect.stringContaining("could not be read") });
    expect(picker.deleted).toBe(3);
  });

  it("says when the person closed the picker", async () => {
    picker.cancel = true;
    expect(await pickCsv()).toEqual({ kind: "cancelled" });
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { and, eq, inArray, sql } from "drizzle-orm";
import { stripMetadata } from "@culinaire/shared";
import { db } from "../db/index.js";
import { auditLog, complianceDocument, organisation, user } from "../db/schema.js";
import {
  CLEANUP_JOB,
  cleanStoredPhotos,
  finishInterruptedCleanups,
  listStoredPhotos,
  type PhotoStorage,
  type StoredPhoto,
} from "./photoMetadataCleanupService.js";

/** Real database, fake storage: nothing here reaches Cloudinary. Gated on TENANT_IT=1 like the other real-DB suites. */
const RUN = process.env.TENANT_IT === "1";
const tag = `pmc_${Date.now().toString(36)}`;

// Synthetic photos, built segment by segment.
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
const jpeg = (...segments: number[][]) =>
  new Uint8Array([0xff, 0xd8, ...seg(0xe0, ascii("JFIF\0")), ...segments.flat(), ...seg(0xda, [1, 2, 3]), 0x10, 0xff, 0x00, 0x20, 0xff, 0xd9]);
/** EXIF whose first directory points at a GPS directory holding a latitude (tag 2). */
const GPS = seg(0xe1, [...ascii("Exif\0\0MM"), 0, 42, 0, 0, 0, 8, 0, 1, 0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0, 0, 1, 0, 2, 0, 5, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
/** The rotation alone, as the upload path writes it. */
const ORIENTATION = [0xff, 0xe1, 0, 34, ...ascii("Exif\0\0MM"), 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
const PHOTOS = {
  location: jpeg(GPS),
  comment: jpeg(seg(0xfe, ascii("a note"))),
  orientation: jpeg(ORIENTATION),
  clean: jpeg(),
  corrupt: new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 1, 2]),
};
type Kind = keyof typeof PHOTOS;

/** In-memory storage that cleans on store with the shared code, as storeDocument does. */
class FakeStorage implements PhotoStorage {
  files = new Map<string, Uint8Array>();
  next = 0;
  failStore = false;
  failRemove = false;
  /** Runs inside store, before the copy exists: lets a test change the row mid-run. */
  onStore?: () => Promise<void>;
  /** What the next download of a stored copy returns instead of its bytes. */
  copyReadsAs?: Uint8Array;
  async download(publicId: string) {
    if (this.copyReadsAs && publicId.includes("/copy-")) return this.copyReadsAs;
    return this.files.get(publicId) ?? null;
  }
  async store(bytes: Uint8Array, organisationId: number, uploadedBy: number) {
    if (this.failStore) throw new Error("storage down");
    await this.onStore?.();
    const id = `culinaire/compliance/org-${organisationId}/user-${uploadedBy}/copy-${this.next++}`;
    this.files.set(id, stripMetadata(bytes)!);
    return id;
  }
  async remove(publicId: string) {
    if (this.failRemove) throw new Error("storage down");
    this.files.delete(publicId);
  }
}

describe.skipIf(!RUN)("photo metadata cleanup (real DB, fake storage)", () => {
  let staff: number;
  let org: number;
  let storage: FakeStorage;
  const ids = {} as Record<Kind, string>;

  const originalId = (kind: Kind) => `culinaire/compliance/org-${org}/user-${staff}/${tag}-${kind}`;
  const ours = async (): Promise<StoredPhoto[]> => (await listStoredPhotos()).photos.filter((p) => p.organisationId === org);
  const pointsAt = async (kind: Kind) =>
    (await db.select({ id: complianceDocument.storagePublicId }).from(complianceDocument).where(eq(complianceDocument.complianceDocumentId, ids[kind])))[0]?.id;
  const steps = async (kind: Kind) =>
    (
      await db
        .select({ metadata: auditLog.metadata })
        .from(auditLog)
        .where(and(eq(auditLog.entityId, ids[kind]), sql`${auditLog.metadata}->>'job' = ${CLEANUP_JOB}`))
        .orderBy(auditLog.createdDttm)
    ).map((r) => (r.metadata as { step: string }).step);

  beforeAll(async () => {
    [{ userId: staff }] = await db.insert(user).values({ userName: "Cleanup IT", userEmail: `${tag}@it.test` }).returning({ userId: user.userId });
    [{ id: org }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-org`, joinKey: `${tag}-jk`, createdBy: staff })
      .returning({ id: organisation.organisationId });
  });

  beforeEach(async () => {
    await db.delete(auditLog).where(eq(auditLog.organisationId, org));
    await db.delete(complianceDocument).where(eq(complianceDocument.organisationId, org));
    storage = new FakeStorage();
    const base = { organisationId: org, userId: staff, uploadedBy: staff, documentType: `${tag}-rsa` };
    for (const kind of Object.keys(PHOTOS) as Kind[]) {
      storage.files.set(originalId(kind), PHOTOS[kind]);
      const [row] = await db
        .insert(complianceDocument)
        .values({ ...base, storagePublicId: originalId(kind), storageFormat: "jpg" })
        .returning({ id: complianceDocument.complianceDocumentId });
      ids[kind] = row.id;
    }
    // Neither is a photo this job reads.
    await db.insert(complianceDocument).values([
      { ...base, storagePublicId: `${originalId("clean")}-pdf`, storageFormat: "pdf" },
      { ...base, storagePublicId: `${originalId("clean")}-old`, storageFormat: null },
    ]);
  });

  afterAll(async () => {
    await db.delete(auditLog).where(eq(auditLog.organisationId, org));
    await db.delete(complianceDocument).where(eq(complianceDocument.organisationId, org));
    await db.delete(organisation).where(eq(organisation.organisationId, org));
    await db.delete(user).where(inArray(user.userId, [staff]));
  });

  it("lists only JPEG and PNG rows, and counts rows with no recorded format", async () => {
    const listed = await listStoredPhotos();
    expect(listed.photos.filter((p) => p.organisationId === org)).toHaveLength(5);
    expect(listed.formatNotRecorded).toBeGreaterThanOrEqual(1);
  });

  it("a dry run counts what the photos carry and changes nothing", async () => {
    const before = new Map(storage.files);
    const report = await cleanStoredPhotos(await ours(), storage, false);
    expect(report).toEqual({ total: 5, location: 1, otherMetadata: 1, clean: 2, unreadable: [ids.corrupt], cleaned: 0, changedMeanwhile: [] });
    expect(storage.files).toEqual(before);
    expect(await pointsAt("location")).toBe(originalId("location"));
    expect(await steps("location")).toEqual([]);
  });

  it("apply replaces each photo with metadata by a clean copy, keeps the document id, and records every step", async () => {
    const report = await cleanStoredPhotos(await ours(), storage, true);
    expect(report).toMatchObject({ location: 1, otherMetadata: 1, clean: 2, cleaned: 2, unreadable: [ids.corrupt] });

    for (const kind of ["location", "comment"] as const) {
      const copy = await pointsAt(kind);
      expect(copy).not.toBe(originalId(kind));
      expect(copy).toMatch(new RegExp(`^culinaire/compliance/org-${org}/user-${staff}/`));
      expect([...storage.files.get(copy!)!]).toEqual([...PHOTOS.clean]);
      expect(storage.files.has(originalId(kind))).toBe(false);
      expect(await steps(kind)).toEqual(["copy_stored", "repointed", "original_removed"]);
    }
    for (const kind of ["orientation", "clean", "corrupt"] as const) {
      expect(await pointsAt(kind)).toBe(originalId(kind));
      expect(storage.files.get(originalId(kind))).toEqual(PHOTOS[kind]);
    }

    // A second run finds nothing left to do.
    expect(await finishInterruptedCleanups(storage)).toBe(0);
    const again = await cleanStoredPhotos(await ours(), storage, true);
    expect(again).toMatchObject({ location: 0, otherMetadata: 0, clean: 4, cleaned: 0 });
  });

  it("stops at a failed store with the original untouched, and a rerun finishes", async () => {
    storage.failStore = true;
    await expect(cleanStoredPhotos(await ours(), storage, true)).rejects.toThrow("storage down");
    const [first] = (await ours()).filter((p) => p.complianceDocumentId === ids.location || p.complianceDocumentId === ids.comment);
    expect(first.storagePublicId).toMatch(/-(location|comment)$/);
    expect(storage.files.get(originalId("location"))).toEqual(PHOTOS.location);

    storage.failStore = false;
    expect((await cleanStoredPhotos(await ours(), storage, true)).cleaned).toBe(2);
  });

  it("a run stopped after moving the row removes the original on the next run", async () => {
    storage.failRemove = true;
    await expect(cleanStoredPhotos(await ours(), storage, true)).rejects.toThrow("storage down");
    const moved = (await pointsAt("location")) !== originalId("location") ? "location" : "comment";
    expect(storage.files.has(originalId(moved))).toBe(true);

    storage.failRemove = false;
    expect(await finishInterruptedCleanups(storage)).toBe(1);
    expect(storage.files.has(originalId(moved))).toBe(false);
    expect(await steps(moved)).toEqual(["copy_stored", "repointed", "original_removed"]);
  });

  it("a copy that does not read back clean stops the run with the original in place, and the next run removes the copy", async () => {
    storage.copyReadsAs = PHOTOS.location;
    await expect(cleanStoredPhotos(await ours(), storage, true)).rejects.toThrow(/did not read back clean/);
    const kind = (await steps("location")).length ? "location" : "comment";
    expect(await pointsAt(kind)).toBe(originalId(kind));
    expect(storage.files.size).toBe(6);

    storage.copyReadsAs = undefined;
    expect(await finishInterruptedCleanups(storage)).toBe(1);
    expect(storage.files.size).toBe(5);
    expect(await steps(kind)).toEqual(["copy_stored", "copy_removed"]);
    expect((await cleanStoredPhotos(await ours(), storage, true)).cleaned).toBe(2);
  });

  it("leaves a photo whose row changed mid-run, removing its copy", async () => {
    const photos = (await ours()).filter((p) => p.complianceDocumentId === ids.location);
    storage.onStore = async () => {
      await db.update(complianceDocument).set({ storagePublicId: `${originalId("location")}-new` }).where(eq(complianceDocument.complianceDocumentId, ids.location));
    };
    const report = await cleanStoredPhotos(photos, storage, true);
    expect(report).toMatchObject({ cleaned: 0, changedMeanwhile: [ids.location] });
    expect([...storage.files.keys()].some((k) => k.includes("/copy-"))).toBe(false);
    expect(storage.files.has(originalId("location"))).toBe(true);
    expect(await steps("location")).toEqual(["copy_stored", "copy_removed"]);
  });

  it("removes a copy whose row was deleted after it moved, as the retention purge can", async () => {
    await cleanStoredPhotos((await ours()).filter((p) => p.complianceDocumentId === ids.location), storage, true);
    const copy = (await pointsAt("location"))!;
    await db.delete(complianceDocument).where(eq(complianceDocument.complianceDocumentId, ids.location));

    expect(await finishInterruptedCleanups(storage)).toBe(1);
    expect(storage.files.has(copy)).toBe(false);
    expect(await finishInterruptedCleanups(storage)).toBe(0);
  });
});

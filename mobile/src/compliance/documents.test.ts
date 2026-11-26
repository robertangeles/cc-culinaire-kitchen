import { describe, it, expect, vi } from "vitest";
import type { MyDocument } from "@culinaire/shared/schemas/compliance";
import { ApiError, type ApiClient } from "../api/client";
import { readSignedImage } from "../api/signedFile";
import { createComplianceApi, type ComplianceApi, type NewDocument } from "./complianceApi";
import { UnsureError, writeMessage } from "../api/onlineWrite";
import { createDocumentStore } from "./documentStore";
import { memoryCache } from "../../testing/mocks";
import { canChange, canNudge, documentSections, expiryLine, isExpired, readFields, readType, statusLabel, uploadMessage } from "./documentView";

const TODAY = "2026-11-26";
const NOW = Date.parse("2026-11-26T00:00:00Z");
const doc = (over: Partial<MyDocument> = {}): MyDocument => ({ complianceDocumentId: "d1", documentType: "RSA", verificationStatus: "Pending", documentNumber: "123", issueDate: "2024-07-08", expiryDate: "2027-07-08", issuingJurisdiction: "VIC", uploadedAt: "2026-11-25T00:00:00Z", rejectionReason: null, storagePublicId: "p1", storageFormat: "jpg", ...over });

describe("a document's state in words", () => {
  it("says who has it and what to do", () => {
    const label = (over: Partial<MyDocument>) => statusLabel(doc(over), TODAY);
    expect([label({}), label({ verificationStatus: "Verified" }), label({ verificationStatus: "Rejected" }), label({ verificationStatus: "Requires Renewal" }), label({ verificationStatus: "Archived", expiryDate: "2020-01-01" }), label({ verificationStatus: "" })]).toEqual(["With your manager", "Verified", "Not accepted", "Renew it", "Archived", "Unknown"]);
  });

  it("calls a verified document past its day expired, and not on the day itself", () => {
    expect(isExpired(doc({ verificationStatus: "Verified", expiryDate: "2026-11-25" }), TODAY)).toBe(true);
    expect(isExpired(doc({ verificationStatus: "Verified", expiryDate: TODAY }), TODAY)).toBe(false);
    expect([expiryLine(doc({ expiryDate: "2026-11-25" }), TODAY), expiryLine(doc(), TODAY), expiryLine(doc({ expiryDate: null }), TODAY)]).toEqual(["Expired 25 November 2026", "Expires 8 July 2027", "No expiry date"]);
  });

  it("puts what needs the person first", () => {
    const docs = [doc({ complianceDocumentId: "ok", verificationStatus: "Verified" }), doc({ complianceDocumentId: "wait" }), doc({ complianceDocumentId: "no", verificationStatus: "Rejected" }), doc({ complianceDocumentId: "old", verificationStatus: "Verified", expiryDate: "2025-01-01" })];
    expect(documentSections(docs, TODAY).map((s) => [s.title, s.docs.map((d) => d.complianceDocumentId)])).toEqual([["Needs you", ["no", "old"]], ["With your manager", ["wait"]], ["On record", ["ok"]]]);
  });

  it("lets the person change only what no manager has signed off, and nudge only after two days", () => {
    expect(["Pending", "Rejected", "Verified", "Expired", "Archived"].map((s) => canChange(doc({ verificationStatus: s })))).toEqual([true, true, false, false, false]);
    expect([canNudge(doc(), NOW), canNudge(doc({ uploadedAt: "2026-11-24T00:00:00Z" }), NOW), canNudge(doc({ uploadedAt: "2026-11-01T00:00:00Z", verificationStatus: "Verified" }), NOW), canNudge(doc({ uploadedAt: "" }), NOW)]).toEqual([false, true, false, false]);
  });
});

describe("the certificate form", () => {
  it("reads the type, and catches a listed one typed under Other", () => {
    expect(readType("RSA", "")).toEqual({ type: "RSA" });
    expect(readType("Other", " First Aid ")).toEqual({ type: "First Aid" });
    expect(readType("Other", "r.s.a")).toEqual({ error: 'Did you mean "RSA"? Pick it from the list instead.' });
    expect([readType(null, ""), readType("Other", " ")]).toEqual([{ error: null }, { error: null }]);
  });

  it("reads the fields, empty ones as none", () => {
    expect(readFields({ documentNumber: " 12 ", issued: "08/07/2026", expires: "", state: "VIC" })).toEqual({ fields: { documentNumber: "12", issueDate: "2026-07-08", expiryDate: null, issuingJurisdiction: "VIC" } });
    expect(readFields({ documentNumber: "", issued: "", expires: "", state: "Not sure" })).toEqual({ fields: { documentNumber: null, issueDate: null, expiryDate: null, issuingJurisdiction: null } });
  });

  it("refuses a date that is not one, and an expiry before the issue", () => {
    const error = (issued: string, expires: string) => (readFields({ documentNumber: "", issued, expires, state: null }) as { error: string }).error;
    expect(error("31/02/2026", "")).toMatch(/issue date/);
    expect(error("", "1/2")).toMatch(/expiry date/);
    expect(error("08/07/2026", "07/07/2026")).toMatch(/before the issue date/);
  });
});

describe("one clear sentence for what went wrong", () => {
  it("on the photo, by status", () => {
    expect(uploadMessage(new ApiError("network"))).toMatch(/no connection/);
    expect(uploadMessage(new ApiError("bad_request", "x", 415))).toMatch(/JPEG or PNG/);
    expect(uploadMessage(new ApiError("server", "x", 503))).toMatch(/can't take documents right now/);
    expect(uploadMessage(new ApiError("server", "boom", 500))).toBe("The photo couldn't be sent. Try again.");
    expect(uploadMessage(new TypeError("x"))).toBe("The photo couldn't be sent. Try again.");
  });

  it("on the rest, with the server's words when it refused", () => {
    expect(writeMessage(new ApiError("network"), "Deleting")).toBe("Deleting needs a connection. Try again with a signal.");
    expect(writeMessage(new ApiError("conflict", "Can't delete a document that is verified", 409), "Deleting")).toBe("Can't delete a document that is verified");
    expect(writeMessage(new ApiError("server", "stack trace", 500), "Deleting")).toBe("The server had a problem. Try again.");
  });
});

describe("the calls", () => {
  it("uploads one file as multipart, then creates the record from what came back", async () => {
    const request = vi.fn(async () => ({ storagePublicId: "p", storageFormat: "jpg", ocr: {} }));
    await createComplianceApi({ request } as unknown as ApiClient).upload({ bytes: new Uint8Array([1, 2]), mimeType: "image/jpeg" }); // its encoding: src/api/photo.test.ts
    expect(request.mock.calls[0].slice(0, 2)).toEqual(["POST", "/api/compliance/documents/upload"]);
  });

  it("reads a signed photo with no token, and says when the link is too old", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 401 }));
    await expect(readSignedImage("https://files.test/x", fetchFn as unknown as typeof fetch)).rejects.toThrow("can't be opened any more");
    expect(fetchFn.mock.calls[0]).toEqual(["https://files.test/x", { headers: { "Cache-Control": "no-store" } }]);
    await expect(readSignedImage("https://files.test/x", (async () => { throw new TypeError("x"); }) as typeof fetch)).rejects.toMatchObject({ code: "network" });
  });
});

describe("sending, changing and deleting", () => {
  const fresh: NewDocument = { documentType: "RSA", engagementType: "employee", documentNumber: null, issueDate: null, expiryDate: null, issuingJurisdiction: null, storagePublicId: "p9", storageFormat: "jpg" };
  function setup(docs: MyDocument[] = [doc()]) {
    const server = { docs };
    const api = { mine: vi.fn(async () => server.docs), upload: vi.fn(), create: vi.fn(async () => {}), update: vi.fn(async () => {}), remove: vi.fn(async () => {}), nudge: vi.fn(async () => {}), viewUrl: vi.fn(), readImage: vi.fn() };
    return { server, api, store: createDocumentStore(api as unknown as ComplianceApi) };
  }

  it("says documents are off, and drops what was shown when access is taken away", async () => {
    const t = setup();
    await t.store.refresh();
    t.api.mine.mockRejectedValueOnce(new ApiError("forbidden", "x", 403));
    await t.store.refresh();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "failed", docs: [] });
    t.api.mine.mockRejectedValueOnce(new ApiError("not_found", "x", 404));
    await t.store.refresh();
    expect(t.store.getSnapshot()).toMatchObject({ phase: "ready", off: true });
  });

  it("shows the sent document straight away", async () => {
    const t = setup([]);
    t.api.create.mockImplementationOnce(async () => void (t.server.docs = [doc({ storagePublicId: "p9" })]));
    await t.store.send(fresh);
    expect(t.store.getSnapshot().docs).toHaveLength(1);
  });

  it("a send whose answer was lost is done when the list holds its file, so it is never made twice", async () => {
    for (const failure of [new ApiError("timeout"), new ApiError("server", "x", 502), new ApiError("conflict", "You've already uploaded a RSA with this document number", 409)]) {
      const t = setup([]);
      t.api.create.mockImplementationOnce(async () => {
        t.server.docs = [doc({ storagePublicId: "p9" })];
        throw failure;
      });
      await expect(t.store.send(fresh)).resolves.toBeUndefined();
    }
  });

  it("looks for a send that landed late before sending the same file again", async () => {
    const t = setup([]);
    t.api.create.mockRejectedValueOnce(new ApiError("timeout"));
    await expect(t.store.send(fresh)).rejects.toMatchObject({ code: "timeout" });
    t.api.mine.mockRejectedValueOnce(new ApiError("network"));
    await expect(t.store.send(fresh)).rejects.toBeInstanceOf(UnsureError);
    t.server.docs = [doc({ storagePublicId: "p9" })];
    await expect(t.store.send(fresh)).resolves.toBeUndefined();
    expect(t.api.create).toHaveBeenCalledTimes(1);
  });

  it("a send that did not land is an error, and one nobody can tell says so", async () => {
    const t = setup([]);
    t.api.create.mockRejectedValueOnce(new ApiError("network"));
    await expect(t.store.send(fresh)).rejects.toMatchObject({ code: "network" });
    const lost = setup([]);
    lost.api.create.mockRejectedValueOnce(new ApiError("timeout"));
    lost.api.mine.mockRejectedValueOnce(new ApiError("network"));
    await expect(lost.store.send(fresh)).rejects.toBeInstanceOf(UnsureError);
    t.api.create.mockRejectedValueOnce(new ApiError("conflict", "You've already uploaded a RSA with this document number", 409));
    t.server.docs = [doc()];
    await expect(t.store.send(fresh)).rejects.toThrow("already uploaded");
  });

  it("a change that did land counts, a refused one does not", async () => {
    const t = setup([doc({ verificationStatus: "Rejected" })]);
    await t.store.refresh();
    const fields = { documentNumber: "9", issueDate: "2024-07-08", expiryDate: null, issuingJurisdiction: null };
    t.api.update.mockImplementationOnce(async () => {
      t.server.docs = [doc({ ...fields, verificationStatus: "Pending" })];
      throw new ApiError("timeout");
    });
    await expect(t.store.update("d1", fields)).resolves.toBeUndefined();
    t.api.update.mockRejectedValueOnce(new ApiError("conflict", "Can't edit a document that is verified", 409));
    await expect(t.store.update("d1", fields)).rejects.toThrow("Can't edit");
  });

  it("a delete of a document already gone is done", async () => {
    const t = setup();
    await t.store.refresh();
    t.api.remove.mockImplementationOnce(async () => {
      t.server.docs = [];
      throw new ApiError("not_found", "Document not found", 404);
    });
    await expect(t.store.remove("d1")).resolves.toBeUndefined();
  });
});

describe("documents saved for a start with no signal", () => {
  it("keeps the list (never a photo), shows it with its time offline, and drops it when the permission goes", async () => {
    const cache = memoryCache();
    const api = { mine: vi.fn(async () => [doc()]) } as unknown as ComplianceApi & { mine: ReturnType<typeof vi.fn> };
    await createDocumentStore(api, cache).refresh();
    expect(cache.write).toHaveBeenCalledWith("documents", "1:L1", [doc()]);
    const offline = createDocumentStore(api, cache);
    api.mine.mockRejectedValueOnce(new ApiError("network"));
    await offline.refresh();
    expect(offline.getSnapshot()).toMatchObject({ phase: "ready", docs: [{ complianceDocumentId: "d1" }], savedAt: "2026-11-25T20:00:00.000Z" });
    api.mine.mockRejectedValueOnce(new ApiError("forbidden", undefined, 403));
    await offline.refresh();
    expect(offline.getSnapshot()).toMatchObject({ phase: "failed", docs: [], savedAt: null });
    expect(cache.rows.size).toBe(0);
  });
});

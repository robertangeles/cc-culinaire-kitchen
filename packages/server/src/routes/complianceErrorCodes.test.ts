import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { SERVER_ERROR_CODES } from "@culinaire/shared";
import { MAX_DOCUMENT_BYTES } from "@culinaire/shared/schemas/compliance";

// A bearer token here is just the payload as JSON, as in profileErrorCodes.test.ts.
vi.mock("../services/authService.js", async (orig) => ({
  ...(await orig<object>()),
  verifyAccessToken: (token: string) => JSON.parse(token),
}));
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../services/settingsService.js", () => ({ getAllSettings: async () => ({ compliance_enabled: "true" }) }));
const getUserLocationContext = vi.fn();
vi.mock("../services/locationContextService.js", () => ({ getUserLocationContext: (...a: unknown[]) => getUserLocationContext(...a) }));
vi.mock("../services/documentOcrService.js", () => ({ extractCertificateFields: vi.fn().mockResolvedValue({}) }));
const service = {
  listDocumentsForUser: vi.fn(),
  createDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  getDocument: vi.fn(),
  nudgeVerifier: vi.fn(),
  verifyDocument: vi.fn(),
};
vi.mock("../services/complianceService.js", async (orig) => ({
  ...(await orig<object>()),
  ...Object.fromEntries(Object.entries(service).map(([k, fn]) => [k, (...a: unknown[]) => fn(...a)])),
}));
const storeDocument = vi.fn();
const signedUrlForDocument = vi.fn();
vi.mock("../services/documentStorageService.js", async (orig) => ({
  ...(await orig<object>()),
  storeDocument: (...a: unknown[]) => storeDocument(...a),
  signedUrlForDocument: (...a: unknown[]) => signedUrlForDocument(...a),
}));

const { default: complianceRouter } = await import("./compliance.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { ComplianceError } = await import("../services/complianceErrors.js");
const { DocumentStorageError } = await import("../services/documentStorageService.js");

/**
 * The compliance routes the phone and the web call: every refusal carries a code from the shared list, and
 * `error` and the status stay what installed apps already show. Through the real router; services are stubbed.
 */

let server: Server;
const STAFF = { sub: 7, roles: [], permissions: ["compliance:read-own"] };
const MANAGER = { sub: 8, roles: [], permissions: ["compliance:read-own", "compliance:verify", "compliance:read-all"] };
const as = (user: object) => ({ authorization: `Bearer ${JSON.stringify(user)}` });

beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use("/api/compliance", complianceRouter);
  app.use(errorHandler);
  server = app.listen(0);
});
afterAll(() => server.close());
beforeEach(() => {
  vi.clearAllMocks();
  getUserLocationContext.mockResolvedValue({ organisationId: 2 });
});

async function call(method: string, path: string, body?: object | FormData, headers: Record<string, string> = as(STAFF)) {
  const isForm = body instanceof FormData;
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/compliance${path}`, {
    method,
    headers: isForm ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> };
}

const known = (code: unknown) => expect(SERVER_ERROR_CODES).toContain(code);
const ID = "3f0c8a52-6b1e-4f7a-9a51-2c4d1e0b9f11";

/** A full row as the table holds it. */
const ROW = {
  complianceDocumentId: ID,
  organisationId: 2,
  storeLocationId: null,
  userId: 7,
  subjectStoreLocationId: null,
  documentType: "RSA",
  engagementType: "employee",
  documentNumber: "RSA-1",
  issueDate: "2026-01-01",
  expiryDate: "2029-01-01",
  issuingAuthority: null,
  issuingJurisdiction: "VIC",
  storagePublicId: "culinaire/compliance/org-2/user-7/abc",
  storageFormat: "jpg",
  verificationStatus: "Rejected",
  employmentEndDate: null,
  uploadedBy: 7,
  uploadedAt: "2026-11-20T01:00:00.000Z",
  verifiedBy: 8,
  verifiedAt: "2026-11-21T01:00:00.000Z",
  rejectionReason: "Photo is blurred",
  notes: "internal note",
  createdDttm: "2026-11-20T01:00:00.000Z",
  updatedDttm: "2026-11-21T01:00:00.000Z",
};

/** What a person's own document screens are sent. */
const STAFF_FIELDS = [
  "complianceDocumentId",
  "documentType",
  "engagementType",
  "documentNumber",
  "issueDate",
  "expiryDate",
  "issuingAuthority",
  "issuingJurisdiction",
  "storagePublicId",
  "storageFormat",
  "verificationStatus",
  "uploadedAt",
  "verifiedAt",
  "rejectionReason",
].sort();

const NEW_DOC = { documentType: "RSA", storagePublicId: ROW.storagePublicId, storageFormat: "jpg" };

describe("a person's own documents", () => {
  it("GET /documents/mine sends only the fields the person's screens use", async () => {
    service.listDocumentsForUser.mockResolvedValue([ROW]);
    const res = await call("GET", "/documents/mine");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body[0]).sort()).toEqual(STAFF_FIELDS);
    expect(res.body[0].rejectionReason).toBe("Photo is blurred");
  });

  it("POST /documents answers with the same fields", async () => {
    service.createDocument.mockResolvedValue({ ...ROW, replay: false });
    const res = await call("POST", "/documents", NEW_DOC);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(STAFF_FIELDS);
  });

  it("PUT /documents/:id answers with the same fields", async () => {
    service.updateDocument.mockResolvedValue(ROW);
    const res = await call("PUT", `/documents/${ID}`, { documentNumber: "RSA-2" });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(STAFF_FIELDS);
  });
});

describe("POST /documents with a client-made id", () => {
  it("passes the id on and answers 201 for a new document", async () => {
    service.createDocument.mockResolvedValue({ ...ROW, replay: false });
    const res = await call("POST", "/documents", { ...NEW_DOC, complianceDocumentId: ID });
    expect(res.status).toBe(201);
    expect(service.createDocument.mock.calls[0][1]).toMatchObject({ complianceDocumentId: ID, userId: 7, uploadedBy: 7 });
  });

  it("answers a repeat 200 with the document it already made", async () => {
    service.createDocument.mockResolvedValue({ ...ROW, replay: true });
    const res = await call("POST", "/documents", { ...NEW_DOC, complianceDocumentId: ID });
    expect(res.status).toBe(200);
    expect(res.body.complianceDocumentId).toBe(ID);
    expect(res.body.replay).toBeUndefined();
  });

  it("still creates without one, as older apps send", async () => {
    service.createDocument.mockResolvedValue({ ...ROW, replay: false });
    const res = await call("POST", "/documents", NEW_DOC);
    expect(res.status).toBe(201);
    expect(service.createDocument.mock.calls[0][1].complianceDocumentId).toBeUndefined();
  });

  it("refuses an id that is not a uuid 400 VALIDATION", async () => {
    const res = await call("POST", "/documents", { ...NEW_DOC, complianceDocumentId: "not-an-id" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
    expect(service.createDocument).not.toHaveBeenCalled();
  });

  it("the venue form takes the id too", async () => {
    service.createDocument.mockResolvedValue({ ...ROW, userId: null, replay: true });
    const res = await call(
      "POST",
      "/documents/venue",
      { ...NEW_DOC, storeLocationId: "6a1b0c4e-8d2f-4b3a-9c5d-7e6f8a9b0c1d", complianceDocumentId: ID },
      as(MANAGER),
    );
    expect(res.status).toBe(200);
    expect(service.createDocument.mock.calls[0][1]).toMatchObject({ complianceDocumentId: ID });
  });
});

describe("POST /documents/upload", () => {
  const form = (bytes: number, field = "file") => {
    const f = new FormData();
    f.append(field, new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "cert.jpg");
    return f;
  };

  it("answers a file over the limit 400 FILE_TOO_LARGE, naming the limit, without storing it", async () => {
    const res = await call("POST", "/documents/upload", form(MAX_DOCUMENT_BYTES + 1));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "File too large. Maximum size is 10 MB.", code: "FILE_TOO_LARGE" });
    known(res.body.code);
    expect(storeDocument).not.toHaveBeenCalled();
  });

  it("answers a file under another field name 400 VALIDATION", async () => {
    const res = await call("POST", "/documents/upload", form(10, "photo"));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("answers a form with no file 400 VALIDATION, same sentence", async () => {
    const res = await call("POST", "/documents/upload", new FormData());
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "A file is required", code: "VALIDATION" });
  });

  it.each([
    [400, "VALIDATION", "That file looks empty."],
    [415, "UNSUPPORTED_FILE_TYPE", "Only PDF, JPG or PNG files are accepted."],
    [503, "STORAGE_UNAVAILABLE", "Can't accept uploads right now."],
    [502, "UPLOAD_FAILED", "Upload didn't finish. Try again."],
  ] as const)("answers a storage refusal %i %s with the same sentence", async (status, code, message) => {
    storeDocument.mockRejectedValue(new DocumentStorageError(message, status, code));
    const res = await call("POST", "/documents/upload", form(10));
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: message, code });
    known(code);
  });
});

describe("every other compliance refusal carries a code", () => {
  it("answers a bad body 400 VALIDATION", async () => {
    const res = await call("POST", "/documents", { documentType: "RSA" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
    expect(typeof res.body.error).toBe("string");
  });

  it("answers a person in no organisation 400 FORBIDDEN, same sentence", async () => {
    getUserLocationContext.mockResolvedValue({ organisationId: null });
    const res = await call("GET", "/documents/mine");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "You are not a member of any organisation", code: "FORBIDDEN" });
  });

  it.each([
    [400, "VALIDATION"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "INVALID_STATE"],
  ] as const)("answers a service refusal %i with %s by default, same sentence", async (status, code) => {
    service.nudgeVerifier.mockRejectedValue(new ComplianceError("Nope", status));
    const res = await call("POST", `/documents/${ID}/nudge`);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: "Nope", code });
  });

  it("answers a service refusal with its own code when it names one", async () => {
    service.updateDocument.mockRejectedValue(new ComplianceError("You've already uploaded a RSA with this document number", 409, "CONFLICT"));
    const res = await call("PUT", `/documents/${ID}`, { documentNumber: "RSA-2" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "You've already uploaded a RSA with this document number", code: "CONFLICT" });
  });

  it("answers a look at someone else's document 403 FORBIDDEN, same sentence", async () => {
    service.getDocument.mockResolvedValue({ ...ROW, userId: 99 });
    signedUrlForDocument.mockResolvedValue(null);
    const res = await call("GET", `/documents/${ID}/view-url`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "You don't have access to this document", code: "FORBIDDEN" });
  });

  it("answers the document store being down 503 STORAGE_UNAVAILABLE on view and delete, not 500", async () => {
    const down = new DocumentStorageError("Can't accept uploads right now.", 503, "STORAGE_UNAVAILABLE");
    service.getDocument.mockResolvedValue(ROW);
    signedUrlForDocument.mockRejectedValue(down);
    service.deleteDocument.mockRejectedValue(down);
    for (const [method, path] of [["GET", `/documents/${ID}/view-url`], ["DELETE", `/documents/${ID}`]]) {
      const res = await call(method, path);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("STORAGE_UNAVAILABLE");
    }
  });

  it("answers a bad report filter 400 VALIDATION", async () => {
    const res = await call("GET", "/report.pdf?storeLocationId=nope", undefined, as(MANAGER));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "storeLocationId must be a valid id", code: "VALIDATION" });
  });

  it("answers too many document views 429 RATE_LIMITED", async () => {
    service.getDocument.mockResolvedValue(ROW);
    signedUrlForDocument.mockResolvedValue("https://signed.example/x");
    const someone = as({ ...STAFF, sub: 70 });
    let last = { status: 0, body: {} as Record<string, any> };
    for (let i = 0; i < 31; i++) last = await call("GET", `/documents/${ID}/view-url`, undefined, someone);
    expect(last.status).toBe(429);
    expect(last.body.code).toBe("RATE_LIMITED");
  });
});

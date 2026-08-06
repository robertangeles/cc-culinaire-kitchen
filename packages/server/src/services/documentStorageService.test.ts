import { describe, it, expect, vi, beforeEach } from "vitest";

const insertValues = vi.fn().mockResolvedValue(undefined);
vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(() => ({ values: insertValues })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) })),
    })),
  },
}));

const uploadStream = vi.fn();
const destroy = vi.fn().mockResolvedValue({ result: "ok" });
const privateDownloadUrl = vi.fn(() => "https://signed.example/doc.pdf");
const configure = vi.fn();
vi.mock("cloudinary", () => ({
  v2: {
    config: (...a: unknown[]) => configure(...a),
    uploader: {
      upload_stream: (...a: unknown[]) => uploadStream(...a),
      destroy: (...a: unknown[]) => destroy(...a),
    },
    utils: { private_download_url: (...a: unknown[]) => privateDownloadUrl(...a) },
  },
}));

const getCredential = vi.fn();
vi.mock("./credentialService.js", () => ({
  getCredentialValueWithFallback: (...a: unknown[]) => getCredential(...a),
}));

import {
  sniffMime,
  storeDocument,
  signedUrlForDocument,
  deleteStoredDocument,
  isStorageConfigured,
  DocumentStorageError,
  SIGNED_URL_TTL_SECONDS,
} from "./documentStorageService.js";

/** All three credentials present. */
function credsOk() {
  getCredential.mockResolvedValue("set");
}
/** Simulate a missing credential — the case that must NEVER fall back to disk. */
function credsMissing() {
  getCredential.mockResolvedValue(undefined);
}

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

beforeEach(() => {
  vi.clearAllMocks();
  insertValues.mockResolvedValue(undefined);
  uploadStream.mockImplementation((_opts: unknown, cb: (e: unknown, r: unknown) => void) => ({
    end: () => cb(null, { public_id: "culinaire/compliance/org-2/abc" }),
  }));
});

describe("sniffMime — content, never the client's declared type", () => {
  it("identifies PDF, JPEG and PNG by magic bytes", () => {
    expect(sniffMime(PDF)).toBe("application/pdf");
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(PNG)).toBe("image/png");
  });

  // An SVG is XML that can carry script, and these files are served back to
  // managers. middleware/upload.ts allows SVG for images; this path must not.
  it("rejects SVG outright", () => {
    expect(sniffMime(SVG)).toBeNull();
  });

  it("rejects a too-short buffer", () => {
    expect(sniffMime(Buffer.from([0x25, 0x50]))).toBeNull();
  });

  // The whole point of sniffing: extension and declared MIME are attacker-controlled.
  it("identifies a PDF regardless of what it was named", () => {
    expect(sniffMime(PDF)).toBe("application/pdf");
  });
});

describe("storeDocument", () => {
  it("uploads with type:private into an org-scoped folder", async () => {
    credsOk();
    const res = await storeDocument(PDF, 2);
    expect(res.publicId).toBe("culinaire/compliance/org-2/abc");
    expect(res.mime).toBe("application/pdf");
    const opts = uploadStream.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.type).toBe("private");
    expect(opts.folder).toBe("culinaire/compliance/org-2");
  });

  it("scopes the folder per organisation", async () => {
    credsOk();
    await storeDocument(PDF, 77);
    const opts = uploadStream.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.folder).toBe("culinaire/compliance/org-77");
  });

  // THE load-bearing test. middleware/upload.ts silently writes to a public
  // /uploads/ path when credentials are absent. Here that must be a hard 503
  // with nothing written anywhere.
  it("HARD-FAILS 503 when credentials are missing — never falls back to disk", async () => {
    credsMissing();
    await expect(storeDocument(PDF, 2)).rejects.toBeInstanceOf(DocumentStorageError);
    await expect(storeDocument(PDF, 2)).rejects.toMatchObject({
      status: 503,
      code: "STORAGE_UNCONFIGURED",
    });
    expect(uploadStream).not.toHaveBeenCalled();
  });

  it("rejects an unsupported type with 415 before touching storage", async () => {
    credsOk();
    await expect(storeDocument(SVG, 2)).rejects.toMatchObject({
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
    expect(uploadStream).not.toHaveBeenCalled();
  });

  it("rejects a zero-byte upload with 400 before touching storage", async () => {
    credsOk();
    await expect(storeDocument(Buffer.alloc(0), 2)).rejects.toMatchObject({
      status: 400,
      code: "EMPTY_UPLOAD",
    });
    expect(uploadStream).not.toHaveBeenCalled();
  });

  it("surfaces an upload failure as 502, not a silent success", async () => {
    credsOk();
    uploadStream.mockImplementation((_o: unknown, cb: (e: unknown, r: unknown) => void) => ({
      end: () => cb(new Error("cloudinary down"), null),
    }));
    await expect(storeDocument(PDF, 2)).rejects.toMatchObject({
      status: 502,
      code: "STORAGE_UPLOAD_FAILED",
    });
  });
});

describe("signedUrlForDocument", () => {
  it("mints a URL with an explicit 120s expiry, not Cloudinary's 1-hour default", async () => {
    credsOk();
    const before = Math.floor(Date.now() / 1000);
    const url = await signedUrlForDocument({
      complianceDocumentId: "doc-1",
      publicId: "pid",
      format: "pdf",
      actorUserId: 5,
      granted: true,
    });
    expect(url).toBe("https://signed.example/doc.pdf");
    const opts = privateDownloadUrl.mock.calls[0][2] as { expires_at: number };
    expect(opts.expires_at).toBeGreaterThanOrEqual(before + SIGNED_URL_TTL_SECONDS);
    expect(opts.expires_at).toBeLessThanOrEqual(before + SIGNED_URL_TTL_SECONDS + 5);
    expect(SIGNED_URL_TTL_SECONDS).toBe(120);
  });

  it("logs a granted access", async () => {
    credsOk();
    await signedUrlForDocument({
      complianceDocumentId: "doc-1",
      publicId: "pid",
      format: "pdf",
      actorUserId: 5,
      ipAddress: "203.0.113.9",
      granted: true,
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        complianceDocumentId: "doc-1",
        actorUserId: 5,
        outcome: "granted",
        ipAddress: "203.0.113.9",
      }),
    );
  });

  // Denials are the interesting rows when reconstructing an incident.
  it("logs a DENIED access and returns no URL", async () => {
    credsOk();
    const url = await signedUrlForDocument({
      complianceDocumentId: "doc-1",
      publicId: "pid",
      format: "pdf",
      actorUserId: 9,
      granted: false,
    });
    expect(url).toBeNull();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 9, outcome: "denied" }),
    );
    expect(privateDownloadUrl).not.toHaveBeenCalled();
  });

  it("records the denial even though no URL is produced", async () => {
    credsMissing();
    const url = await signedUrlForDocument({
      complianceDocumentId: "doc-1",
      publicId: "pid",
      format: "pdf",
      actorUserId: 9,
      granted: false,
    });
    expect(url).toBeNull();
    expect(insertValues).toHaveBeenCalledTimes(1);
  });
});

describe("deleteStoredDocument", () => {
  // Deleting only the row strands the blob where no retention policy reaches it.
  it("destroys the private object", async () => {
    credsOk();
    await deleteStoredDocument("pid-1");
    expect(destroy).toHaveBeenCalledWith("pid-1", expect.objectContaining({ type: "private" }));
  });

  it("hard-fails rather than silently skipping when credentials are missing", async () => {
    credsMissing();
    await expect(deleteStoredDocument("pid-1")).rejects.toMatchObject({ status: 503 });
    expect(destroy).not.toHaveBeenCalled();
  });
});

describe("isStorageConfigured", () => {
  it("is true with credentials and false without", async () => {
    credsOk();
    await expect(isStorageConfigured()).resolves.toBe(true);
    credsMissing();
    await expect(isStorageConfigured()).resolves.toBe(false);
  });
});

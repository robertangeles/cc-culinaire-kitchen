import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const recognizeMock = vi.fn();
const createWorkerMock = vi.fn(async () => ({ recognize: recognizeMock }));

vi.mock("tesseract.js", () => ({
  createWorker: createWorkerMock,
}));

const { extractCertificateFields, parseCertificateText } = await import("./documentOcrService.js");

describe("parseCertificateText", () => {
  it("parses DD/MM/YYYY (numeric slash)", () => {
    expect(parseCertificateText("Expiry Date: 15/06/2026")).toEqual({ expiryDate: "2026-06-15" });
  });

  it("parses DD-MM-YYYY (numeric hyphen)", () => {
    expect(parseCertificateText("Expiry Date: 15-06-2026")).toEqual({ expiryDate: "2026-06-15" });
  });

  it("parses D MMM YYYY (abbreviated month name)", () => {
    expect(parseCertificateText("Issued 5 Jun 2026")).toEqual({ issueDate: "2026-06-05" });
  });

  it("parses D Month YYYY (full month name, with comma)", () => {
    expect(parseCertificateText("Issue Date: 5 June, 2026")).toEqual({ issueDate: "2026-06-05" });
  });

  it("resolves day-first, not month-first, when both day and month are <= 12", () => {
    // 03/04/2026 is 3 April in Australian order, never 4 March (US order).
    expect(parseCertificateText("Expiry: 03/04/2026")).toEqual({ expiryDate: "2026-04-03" });
  });

  it("reads issue and expiry correctly when both dates share one line", () => {
    const result = parseCertificateText("Issued 01/01/2024 - Expires 31/12/2026");
    expect(result).toEqual({ issueDate: "2024-01-01", expiryDate: "2026-12-31" });
  });

  it("falls back to the next line when the label and date are split across lines", () => {
    const result = parseCertificateText("Expiry Date\n15/06/2026");
    expect(result).toEqual({ expiryDate: "2026-06-15" });
  });

  it("extracts a certificate number after a 'Certificate No' label", () => {
    expect(parseCertificateText("Certificate No: 2026-004521")).toEqual({
      documentNumber: "2026-004521",
    });
  });

  it("extracts a certificate number after a 'Certificate Number' label", () => {
    expect(parseCertificateText("Certificate Number 12345")).toEqual({ documentNumber: "12345" });
  });

  it("extracts a certificate number after a 'Cert No' label, skipping a letter prefix", () => {
    expect(parseCertificateText("Cert No: CN-9988")).toEqual({ documentNumber: "9988" });
  });

  it("returns only the fields it found — missing fields are simply absent", () => {
    expect(parseCertificateText("Certificate No: 555\nNo dates on this document.")).toEqual({
      documentNumber: "555",
    });
  });

  it("returns {} for garbage input with no recognizable fields", () => {
    expect(parseCertificateText("asd9 !! kq;lz random OCR noise 42")).toEqual({});
  });

  it("returns {} for an empty string", () => {
    expect(parseCertificateText("")).toEqual({});
  });
});

describe("extractCertificateFields", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    recognizeMock.mockReset();
  });

  it("creates the tesseract worker once and reuses it across calls", async () => {
    recognizeMock.mockResolvedValue({ data: { text: "Certificate No: 2026-004521" } });

    const first = await extractCertificateFields(Buffer.from("page-1"));
    const second = await extractCertificateFields(Buffer.from("page-2"));

    expect(createWorkerMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ documentNumber: "2026-004521" });
    expect(second).toEqual({ documentNumber: "2026-004521" });
  });

  it("returns {} when recognition exceeds the 5s budget instead of hanging", async () => {
    vi.useFakeTimers();
    recognizeMock.mockImplementation(() => new Promise(() => {})); // never resolves

    const pending = extractCertificateFields(Buffer.from("slow-page"));
    await vi.advanceTimersByTimeAsync(5000);

    expect(await pending).toEqual({});
  });

  it("returns {} when the worker throws, never surfacing the error", async () => {
    recognizeMock.mockRejectedValue(new Error("worker crashed"));

    await expect(extractCertificateFields(Buffer.from("bad-page"))).resolves.toEqual({});
  });
});

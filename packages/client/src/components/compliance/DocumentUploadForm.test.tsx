import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocumentUploadForm } from "./DocumentUploadForm.js";

/**
 * Two things this form must never regress: OCR pre-fill is visibly marked
 * (the manager review depends on that provenance), and a second tap on
 * Submit before the network round-trip completes must never create a
 * second document.
 */

function mockFetch(createDocument: (body: any) => void) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/documents/upload")) {
      return {
        ok: true,
        json: async () => ({
          storagePublicId: "culinaire/compliance/abc123",
          ocr: { documentNumber: "RSA-999", expiryDate: "2027-05-01" },
        }),
      } as Response;
    }
    if (url.endsWith("/api/compliance/documents") && init?.method === "POST") {
      createDocument(JSON.parse(init.body as string));
      return { ok: true, json: async () => ({ complianceDocumentId: "new-doc" }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

const file = new File(["fake-image-bytes"], "rsa.jpg", { type: "image/jpeg" });

async function selectTypeAndFile() {
  fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "RSA" } });
  const input = document.getElementById("document-file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByDisplayValue("RSA-999")).toBeInTheDocument());
}

describe("DocumentUploadForm", () => {
  let createDocument: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createDocument = vi.fn();
    vi.stubGlobal("fetch", mockFetch(createDocument));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("marks OCR-prefilled fields as read from photo, and leaves untouched fields unmarked", async () => {
    render(<DocumentUploadForm />);
    await selectTypeAndFile();

    // documentNumber and expiryDate came from OCR; issueDate did not.
    expect(screen.getAllByText("read from photo")).toHaveLength(2);
    expect(screen.getByLabelText(/Issued/).parentElement?.textContent).not.toContain("read from photo");
  });

  it("submits the OCR-derived storagePublicId and the (possibly corrected) field values", async () => {
    render(<DocumentUploadForm />);
    await selectTypeAndFile();

    // Staff corrects the OCR-read certificate number before sending.
    fireEvent.change(screen.getByLabelText(/Certificate number/), { target: { value: "RSA-CORRECTED" } });
    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));

    await waitFor(() => expect(screen.getByText("Sent for review")).toBeInTheDocument());
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "RSA",
        documentNumber: "RSA-CORRECTED",
        storagePublicId: "culinaire/compliance/abc123",
        engagementType: "employee",
      }),
    );
  });

  it("CV-F1: lets a contractor pick their engagement type, and submits it", async () => {
    render(<DocumentUploadForm />);
    await selectTypeAndFile();

    fireEvent.change(screen.getByLabelText("I'm working here as a"), { target: { value: "contractor" } });
    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));

    await waitFor(() => expect(screen.getByText("Sent for review")).toBeInTheDocument());
    expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({ engagementType: "contractor" }));
  });

  it("guards double-tap submit — one tap creates exactly one document", async () => {
    render(<DocumentUploadForm />);
    await selectTypeAndFile();

    const submit = screen.getByRole("button", { name: "Send for review" });
    fireEvent.click(submit);
    fireEvent.click(submit); // fires before the first request resolves

    await waitFor(() => expect(screen.getByText("Sent for review")).toBeInTheDocument());
    expect(createDocument).toHaveBeenCalledTimes(1);
  });

  it("cannot submit before a document type and file are provided", async () => {
    render(<DocumentUploadForm />);
    expect(screen.getByRole("button", { name: "Send for review" })).toBeDisabled();
  });

  it("typing a near-duplicate of a canonical type under Other is refused, not silently submitted", async () => {
    render(<DocumentUploadForm />);
    fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "Other" } });

    fireEvent.change(screen.getByPlaceholderText("Name the document"), { target: { value: "R.S.A" } });

    expect(screen.getByText(/Did you mean.*RSA/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send for review" })).toBeDisabled();
  });
});

describe("DocumentUploadForm — what is sent", () => {
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
  const PICTURE = [...seg(0xe0, ascii("JFIF\0")), ...seg(0xdb, [9, 9]), ...seg(0xda, [1, 2, 3]), 0x10, 0xff, 0xd9];
  const located = new Uint8Array([0xff, 0xd8, ...seg(0xe1, ascii("Exif\0\0GPS-37.81,144.96")), ...PICTURE]);

  let sent: File[];
  let creates: any[];
  let failNextCreate: boolean;

  beforeEach(() => {
    sent = [];
    creates = [];
    failNextCreate = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/documents/upload")) {
          sent.push((init!.body as FormData).get("file") as File);
          return { ok: true, json: async () => ({ storagePublicId: "culinaire/compliance/abc123", ocr: {} }) } as Response;
        }
        creates.push(JSON.parse(init!.body as string));
        if (failNextCreate) {
          failNextCreate = false;
          throw new TypeError("Failed to fetch");
        }
        return { ok: true, json: async () => ({}) } as Response;
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  async function choose(f: File) {
    fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "RSA" } });
    fireEvent.change(document.getElementById("document-file") as HTMLInputElement, { target: { files: [f] } });
    await waitFor(() => expect(sent).toHaveLength(1));
  }

  it("sends a photo without the place it was taken, picture unchanged", async () => {
    render(<DocumentUploadForm />);
    await choose(new File([located], "rsa.jpg", { type: "image/jpeg" }));
    expect([...new Uint8Array(await sent[0].arrayBuffer())]).toEqual([0xff, 0xd8, ...PICTURE]);
    expect(sent[0].name).toBe("rsa.jpg");
    expect(sent[0].type).toBe("image/jpeg");
  });

  it("sends a PDF as chosen", async () => {
    const pdf = new File(["%PDF-1.7 certificate"], "rsa.pdf", { type: "application/pdf" });
    render(<DocumentUploadForm />);
    await choose(pdf);
    expect(await sent[0].text()).toBe("%PDF-1.7 certificate");
  });

  it("sends the same id again when a send's answer was lost, so it is not made twice", async () => {
    render(<DocumentUploadForm />);
    await choose(new File([located], "rsa.jpg", { type: "image/jpeg" }));
    failNextCreate = true;
    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
    await waitFor(() => expect(creates).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send for review" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
    await waitFor(() => expect(screen.getByText("Sent for review")).toBeInTheDocument());
    expect(creates[0].complianceDocumentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(creates[1].complianceDocumentId).toBe(creates[0].complianceDocumentId);
  });
});

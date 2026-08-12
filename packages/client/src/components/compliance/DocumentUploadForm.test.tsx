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
      }),
    );
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
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MyDocumentsList } from "./MyDocumentsList.js";

/**
 * Pending and Rejected are the two states a staff member actually needs
 * information from, not just a status word — who has it / since when, and
 * what to fix. Both are asserted here so a refactor can't silently drop them
 * back to a bare status pill.
 */

function stubDocuments(documents: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => documents }) as Response),
  );
}

describe("MyDocumentsList", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows an inviting empty state with no documents", async () => {
    stubDocuments([]);
    render(<MyDocumentsList />);
    await waitFor(() => expect(screen.getByText("Add your first certificate")).toBeInTheDocument());
    expect(screen.getByText("Takes about a minute.")).toBeInTheDocument();
  });

  it("tells a pending document's owner who has it and since when", async () => {
    stubDocuments([
      {
        complianceDocumentId: "doc-1",
        documentType: "RSA",
        verificationStatus: "Pending",
        expiryDate: null,
        uploadedAt: "2026-06-03T00:00:00.000Z",
        rejectionReason: null,
      },
    ]);
    render(<MyDocumentsList />);
    await waitFor(() => expect(screen.getByText("RSA")).toBeInTheDocument());
    expect(screen.getByText("With your manager since 3 June 2026")).toBeInTheDocument();
  });

  it("shows the rejection reason so the staff member knows what to fix", async () => {
    stubDocuments([
      {
        complianceDocumentId: "doc-2",
        documentType: "Food Handler",
        verificationStatus: "Rejected",
        expiryDate: null,
        uploadedAt: "2026-06-01T00:00:00.000Z",
        rejectionReason: "Photo is too blurry to read the certificate number",
      },
    ]);
    render(<MyDocumentsList />);
    await waitFor(() =>
      expect(screen.getByText("Photo is too blurry to read the certificate number")).toBeInTheDocument(),
    );
    expect(screen.getByText("What to fix")).toBeInTheDocument();
  });

  it("carries document, status and expiry in the pill's aria-label", async () => {
    stubDocuments([
      {
        complianceDocumentId: "doc-3",
        documentType: "RSA",
        verificationStatus: "Expired",
        expiryDate: "2026-06-15",
        uploadedAt: "2026-01-01T00:00:00.000Z",
        rejectionReason: null,
      },
    ]);
    render(<MyDocumentsList />);
    await waitFor(() =>
      expect(screen.getByLabelText("RSA: Expired, expires 15 June 2026")).toBeInTheDocument(),
    );
  });
});

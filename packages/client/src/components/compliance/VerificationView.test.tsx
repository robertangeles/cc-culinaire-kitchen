import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VerificationView } from "./VerificationView.js";

/**
 * The whole anti-rubber-stamp mechanism is the constraint that reject
 * cannot submit without a reason — a manager who can dismiss a bad document
 * with an empty click makes the queue meaningless. This is the one thing
 * this component must never regress.
 */

const PENDING = [
  {
    complianceDocumentId: "doc-1",
    documentType: "RSA",
    engagementType: "employee",
    documentNumber: "RSA-123",
    issueDate: "2025-01-01",
    expiryDate: "2027-01-01",
    issuingJurisdiction: "VIC",
    staffName: "Alex Chen",
    uploadedAt: "2026-06-01T00:00:00.000Z",
    ocrFilledFields: ["documentNumber", "expiryDate"],
  },
  {
    complianceDocumentId: "doc-2",
    documentType: "Food Handler",
    engagementType: "contractor",
    documentNumber: null,
    issueDate: null,
    expiryDate: null,
    issuingJurisdiction: null,
    staffName: "Sam Lee",
    uploadedAt: "2026-06-02T00:00:00.000Z",
  },
];

function mockFetch() {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes("/pending")) {
      return { ok: true, json: async () => PENDING } as Response;
    }
    if (url.includes("/view-url")) {
      // Not wired server-side yet — the component must degrade, not crash.
      return { ok: false, json: async () => ({}) } as Response;
    }
    if (url.includes("/verify") || url.includes("/reject")) {
      return { ok: true, json: async () => ({ ...PENDING[0], verificationStatus: "Verified" }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

describe("VerificationView", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("marks OCR-filled fields with the read-from-photo caption, and only those fields", async () => {
    render(<VerificationView />);
    await waitFor(() => expect(screen.getByText("Alex Chen")).toBeInTheDocument());
    expect(screen.getAllByText("read from photo")).toHaveLength(2); // documentNumber, expiryDate
    expect(screen.getByText("Issued").closest("p")?.textContent).not.toContain("read from photo");
  });

  it("cannot submit a rejection with an empty reason", async () => {
    render(<VerificationView />);
    await waitFor(() => expect(screen.getByText("Alex Chen")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const confirmButton = screen.getByRole("button", { name: "Confirm reject" });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(confirmButton);
    // Still on doc-1 — no reject call went through.
    expect(screen.getByText("Alex Chen")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Reason for rejection"), {
      target: { value: "Certificate number is unreadable" },
    });
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    await waitFor(() => expect(screen.getByText("Sam Lee")).toBeInTheDocument());

    const rejectCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes("/reject"),
    );
    expect(rejectCall).toBeTruthy();
    expect(JSON.parse((rejectCall![1] as RequestInit).body as string)).toEqual({
      reason: "Certificate number is unreadable",
    });
  });

  it("approving advances to the next document and shows the queue progress", async () => {
    render(<VerificationView />);
    await waitFor(() => expect(screen.getByText("1 of 2 pending")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText("Sam Lee")).toBeInTheDocument());
    expect(screen.getByText("2 of 2 pending")).toBeInTheDocument();
  });

  it("shows an all-caught-up state once the queue is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => [] }) as Response),
    );
    render(<VerificationView />);
    await waitFor(() => expect(screen.getByText("All caught up")).toBeInTheDocument());
  });
});

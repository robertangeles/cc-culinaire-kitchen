import { StrictMode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

  // Regression: CV-A1 — My Documents spun forever under React 18 StrictMode
  // mountedRef was set false on unmount but never reset true on the next
  // mount, so StrictMode's dev-only double-invoke discarded the kept
  // fetch's result and the list never left the loading state.
  // Found by /qa on 2026-09-18
  // Report: docs/qa/rostering-compliance-test-plan.md (CV-A1)
  it("still resolves out of loading under StrictMode's double-invoked mount effect", async () => {
    stubDocuments([]);
    render(
      <StrictMode>
        <MyDocumentsList />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByText("Add your first certificate")).toBeInTheDocument());
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

  it("offers edit/delete on a Pending document, but not on a Verified one", async () => {
    stubDocuments([
      {
        complianceDocumentId: "doc-pending",
        documentType: "RSA",
        verificationStatus: "Pending",
        expiryDate: null,
        uploadedAt: "2026-06-03T00:00:00.000Z",
        rejectionReason: null,
      },
      {
        complianceDocumentId: "doc-verified",
        documentType: "Visa / Work Rights",
        verificationStatus: "Verified",
        expiryDate: null,
        uploadedAt: "2026-06-01T00:00:00.000Z",
        rejectionReason: null,
      },
    ]);
    render(<MyDocumentsList />);
    await waitFor(() => expect(screen.getByText("RSA")).toBeInTheDocument());

    expect(screen.getByLabelText("Edit RSA")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete RSA")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit Visa / Work Rights")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete Visa / Work Rights")).not.toBeInTheDocument();
  });

  it("edits a document's fields and refreshes the list on save", async () => {
    const pending = {
      complianceDocumentId: "doc-1",
      documentType: "RSA",
      verificationStatus: "Pending",
      documentNumber: null,
      expiryDate: null,
      uploadedAt: "2026-06-03T00:00:00.000Z",
      rejectionReason: null,
    };
    let saveBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          saveBody = JSON.parse(init.body as string);
          return { ok: true, json: async () => ({ ...pending, ...saveBody }) } as Response;
        }
        return { ok: true, json: async () => [pending] } as Response;
      }),
    );

    render(<MyDocumentsList />);
    await waitFor(() => expect(screen.getByText("RSA")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Edit RSA"));
    fireEvent.change(screen.getByLabelText("Certificate number"), { target: { value: "RSA-999" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveBody).toMatchObject({ documentNumber: "RSA-999", issueDate: null, expiryDate: null }),
    );
    // The edit form closes once the save round-trip resolves.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
  });

  it("deletes a document after confirming, and removes it from the list", async () => {
    const pending = {
      complianceDocumentId: "doc-1",
      documentType: "RSA",
      verificationStatus: "Pending",
      expiryDate: null,
      uploadedAt: "2026-06-03T00:00:00.000Z",
      rejectionReason: null,
    };
    let deleted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          deleted = true;
          return { ok: true, status: 204, json: async () => ({}) } as Response;
        }
        return { ok: true, json: async () => (deleted ? [] : [pending]) } as Response;
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<MyDocumentsList />);
    await waitFor(() => expect(screen.getByText("RSA")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Delete RSA"));

    await waitFor(() => expect(screen.getByText("Add your first certificate")).toBeInTheDocument());
  });

  it("does not delete when the confirmation is dismissed", async () => {
    const pending = {
      complianceDocumentId: "doc-1",
      documentType: "RSA",
      verificationStatus: "Pending",
      expiryDate: null,
      uploadedAt: "2026-06-03T00:00:00.000Z",
      rejectionReason: null,
    };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [pending] }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<MyDocumentsList />);
    await waitFor(() => expect(screen.getByText("RSA")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Delete RSA"));

    expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial GET — no DELETE fired
    expect(screen.getByText("RSA")).toBeInTheDocument();
  });

  it("View opens a read-only panel with the upload form's fields plus a file preview — on every status, including Verified", async () => {
    const verified = {
      complianceDocumentId: "doc-1",
      documentType: "Visa / Work Rights",
      verificationStatus: "Verified",
      documentNumber: "VWR-42",
      issueDate: "2026-01-10",
      expiryDate: null,
      issuingJurisdiction: "NSW",
      uploadedAt: "2026-06-01T00:00:00.000Z",
      rejectionReason: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/view-url")) {
          return { ok: true, json: async () => ({ url: "https://signed.example/doc-1" }) } as Response;
        }
        return { ok: true, json: async () => [verified] } as Response;
      }),
    );

    render(<MyDocumentsList />);
    await waitFor(() => expect(screen.getByText("Visa / Work Rights")).toBeInTheDocument());
    // Verified still gets a View button — only edit/delete are withheld from it.
    expect(screen.getByLabelText("View Visa / Work Rights")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("View Visa / Work Rights"));

    await waitFor(() => expect(screen.getByTitle("Visa / Work Rights document")).toBeInTheDocument());
    expect(screen.getByText("VWR-42")).toBeInTheDocument();
    expect(screen.getByText("NSW")).toBeInTheDocument();
    // Read-only: no editable inputs anywhere in the panel.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows an inline error and keeps the edit form open when saving fails", async () => {
    const pending = {
      complianceDocumentId: "doc-1",
      documentType: "RSA",
      verificationStatus: "Pending",
      documentNumber: null,
      expiryDate: null,
      uploadedAt: "2026-06-03T00:00:00.000Z",
      rejectionReason: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return { ok: false, json: async () => ({ error: "Couldn't save your changes." }) } as Response;
        }
        return { ok: true, json: async () => [pending] } as Response;
      }),
    );

    render(<MyDocumentsList />);
    await waitFor(() => expect(screen.getByText("RSA")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Edit RSA"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Couldn't save your changes.")).toBeInTheDocument());
    // The form is still open — the failed save didn't get treated as a success.
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("shows an error (and stops rendering the list) when the delete request fails", async () => {
    const pending = {
      complianceDocumentId: "doc-1",
      documentType: "RSA",
      verificationStatus: "Pending",
      expiryDate: null,
      uploadedAt: "2026-06-03T00:00:00.000Z",
      rejectionReason: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return { ok: false, status: 500, json: async () => ({ error: "Couldn't delete this document." }) } as Response;
        }
        return { ok: true, json: async () => [pending] } as Response;
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<MyDocumentsList />);
    await waitFor(() => expect(screen.getByText("RSA")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Delete RSA"));

    await waitFor(() => expect(screen.getByText("Couldn't delete this document.")).toBeInTheDocument());
  });

  it("offers edit/delete on a Rejected document too, not just Pending", async () => {
    stubDocuments([
      {
        complianceDocumentId: "doc-rejected",
        documentType: "Food Handler",
        verificationStatus: "Rejected",
        expiryDate: null,
        uploadedAt: "2026-06-01T00:00:00.000Z",
        rejectionReason: "Blurry photo",
      },
    ]);
    render(<MyDocumentsList />);
    await waitFor(() => expect(screen.getByText("Food Handler")).toBeInTheDocument());

    expect(screen.getByLabelText("Edit Food Handler")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete Food Handler")).toBeInTheDocument();
  });

  it("View toggles closed on a second click", async () => {
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

    fireEvent.click(screen.getByLabelText("View RSA"));
    await waitFor(() => expect(screen.getByText("Close")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("View RSA"));
    expect(screen.queryByText("Close")).not.toBeInTheDocument();
  });

  it("shows a preview error inline (without losing the list) when the signed URL can't be fetched", async () => {
    const pending = {
      complianceDocumentId: "doc-1",
      documentType: "RSA",
      verificationStatus: "Pending",
      expiryDate: null,
      uploadedAt: "2026-06-03T00:00:00.000Z",
      rejectionReason: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/view-url")) return { ok: false, json: async () => ({}) } as Response;
        return { ok: true, json: async () => [pending] } as Response;
      }),
    );

    render(<MyDocumentsList />);
    await waitFor(() => expect(screen.getByText("RSA")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("View RSA"));

    await waitFor(() => expect(screen.getByText("Preview isn't available right now.")).toBeInTheDocument());
    expect(screen.getByText("RSA")).toBeInTheDocument();
  });

  it("opening Edit closes an open View panel, and vice versa", async () => {
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

    fireEvent.click(screen.getByLabelText("View RSA"));
    await waitFor(() => expect(screen.getByText("Close")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Edit RSA"));
    expect(screen.queryByText("Close")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("opening View closes an open Edit form (the reverse direction)", async () => {
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

    fireEvent.click(screen.getByLabelText("Edit RSA"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("View RSA"));
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Close")).toBeInTheDocument());
  });
});

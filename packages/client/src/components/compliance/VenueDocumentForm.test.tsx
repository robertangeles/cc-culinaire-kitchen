import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VenueDocumentForm } from "./VenueDocumentForm.js";

/**
 * CV-E1: a venue document has no staff subject, so the form can't submit
 * without a venue picked — the one thing that must never regress is
 * "Save" staying disabled until a venue, a document type, and a completed
 * file upload are all present.
 */

const VENUES = [
  { storeLocationId: "loc-1", locationName: "Almost French Pâtisserie" },
  { storeLocationId: "loc-2", locationName: "Second Venue" },
];

function mockFetch(overrides: { locationContext?: "fail"; upload?: "fail"; venueCreate?: string } = {}) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes("/location-context")) {
      if (overrides.locationContext === "fail") return { ok: false, json: async () => ({}) } as Response;
      return { ok: true, json: async () => ({ locations: VENUES }) } as Response;
    }
    if (url.includes("/documents/upload")) {
      if (overrides.upload === "fail") {
        return { ok: false, json: async () => ({ error: "Couldn't read that file. Try again." }) } as Response;
      }
      return { ok: true, json: async () => ({ storagePublicId: "culinaire/compliance/org-1/user-1/x", storageFormat: "pdf" }) } as Response;
    }
    if (url.includes("/documents/venue")) {
      if (overrides.venueCreate) {
        return { ok: false, json: async () => ({ error: overrides.venueCreate }) } as Response;
      }
      return { ok: true, json: async () => ({ complianceDocumentId: "doc-1" }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

describe("VenueDocumentForm", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts collapsed behind an 'Add venue document' affordance", () => {
    render(<VenueDocumentForm />);
    expect(screen.getByText("+ Add venue document")).toBeInTheDocument();
    expect(screen.queryByLabelText("Venue")).not.toBeInTheDocument();
  });

  it("Save stays disabled until document type, venue, and a completed upload are all present", async () => {
    vi.stubGlobal("fetch", mockFetch());
    render(<VenueDocumentForm />);
    fireEvent.click(screen.getByText("+ Add venue document"));

    const saveButton = await screen.findByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "Liquor Licence" } });
    expect(saveButton).toBeDisabled();

    await waitFor(() => expect(screen.getByLabelText("Venue")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "loc-1" } });
    expect(saveButton).toBeDisabled(); // still no file uploaded

    const file = new File(["bytes"], "licence.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText(/Choose a file/i, { selector: "input" }), {
      target: { files: [file] },
    });

    await waitFor(() => expect(saveButton).not.toBeDisabled());
  });

  it("submits the venue subject, not a staff member, and confirms success", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<VenueDocumentForm />);
    fireEvent.click(screen.getByText("+ Add venue document"));

    fireEvent.change(await screen.findByLabelText("Document type"), { target: { value: "Liquor Licence" } });
    await waitFor(() => expect(screen.getByLabelText("Venue")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "loc-1" } });
    const file = new File(["bytes"], "licence.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText(/Choose a file/i, { selector: "input" }), {
      target: { files: [file] },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Venue document saved.")).toBeInTheDocument());

    const venueCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/documents/venue"));
    expect(venueCall).toBeDefined();
    const body = JSON.parse((venueCall![1] as RequestInit).body as string);
    expect(body.storeLocationId).toBe("loc-1");
    expect(body.userId).toBeUndefined();
  });

  it("shows an error and an empty (not stuck-loading) venue picker when the venue list fails to load", async () => {
    vi.stubGlobal("fetch", mockFetch({ locationContext: "fail" }));
    render(<VenueDocumentForm />);
    fireEvent.click(screen.getByText("+ Add venue document"));

    await waitFor(() => expect(screen.getByText("Couldn't load your venues.")).toBeInTheDocument());
    expect(screen.getByLabelText("Venue")).not.toBeDisabled();
    expect(screen.getByText("Choose a venue")).toBeInTheDocument();
  });

  it("shows an upload error and keeps Save disabled when the file upload fails", async () => {
    vi.stubGlobal("fetch", mockFetch({ upload: "fail" }));
    render(<VenueDocumentForm />);
    fireEvent.click(screen.getByText("+ Add venue document"));

    fireEvent.change(await screen.findByLabelText("Document type"), { target: { value: "Liquor Licence" } });
    await waitFor(() => expect(screen.getByLabelText("Venue")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "loc-1" } });

    const file = new File(["bytes"], "licence.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText(/Choose a file/i, { selector: "input" }), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(screen.getByText("Couldn't read that file. Try again.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows the server's error and does not mark the form done when saving the venue document fails", async () => {
    vi.stubGlobal("fetch", mockFetch({ venueCreate: "You've already uploaded a Liquor Licence for this venue" }));
    render(<VenueDocumentForm />);
    fireEvent.click(screen.getByText("+ Add venue document"));

    fireEvent.change(await screen.findByLabelText("Document type"), { target: { value: "Liquor Licence" } });
    await waitFor(() => expect(screen.getByLabelText("Venue")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "loc-1" } });
    const file = new File(["bytes"], "licence.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText(/Choose a file/i, { selector: "input" }), {
      target: { files: [file] },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        screen.getByText("You've already uploaded a Liquor Licence for this venue"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Venue document saved.")).not.toBeInTheDocument();
  });
});

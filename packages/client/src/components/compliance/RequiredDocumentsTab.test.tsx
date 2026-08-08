import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RequiredDocumentsTab } from "./RequiredDocumentsTab.js";

/**
 * The one thing this screen must never get wrong: zero required document
 * types means the whole Compliance vault is checking nothing, so that state
 * must read as a warning, not a calm empty list. Everything else here is the
 * ordinary save-flow coverage — toggle on, toggle off, and the save failing.
 */

function mockFetch(options: {
  initial?: string[];
  onPut?: (documentTypes: string[]) => { ok: boolean; body: unknown };
}) {
  const initial = options.initial ?? [];
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const { documentTypes } = JSON.parse(init.body as string);
      const result = options.onPut?.(documentTypes) ?? { ok: true, body: documentTypes };
      return { ok: result.ok, json: async () => result.body } as Response;
    }
    return { ok: true, json: async () => initial } as Response;
  });
}

describe("RequiredDocumentsTab", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("warns that nothing is being checked when no document types are required", async () => {
    vi.stubGlobal("fetch", mockFetch({ initial: [] }));
    render(<RequiredDocumentsTab />);
    await waitFor(() => expect(screen.getByText("Nothing is required yet")).toBeInTheDocument());
    expect(screen.getByText(/the vault isn't checking anything/i)).toBeInTheDocument();
  });

  it("does not show the warning once at least one document type is required", async () => {
    vi.stubGlobal("fetch", mockFetch({ initial: ["RSA"] }));
    render(<RequiredDocumentsTab />);
    await waitFor(() => expect(screen.getByLabelText("RSA")).toBeChecked());
    expect(screen.queryByText("Nothing is required yet")).not.toBeInTheDocument();
  });

  it("lets an admin turn a document type on, saving the full updated set", async () => {
    vi.stubGlobal("fetch", mockFetch({ initial: [] }));
    render(<RequiredDocumentsTab />);
    await waitFor(() => expect(screen.getByLabelText("RSA")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("RSA"));

    await waitFor(() => expect(screen.getByLabelText("RSA")).toBeChecked());
    expect(screen.queryByText("Nothing is required yet")).not.toBeInTheDocument();
    expect(screen.getByText("Every staff member must hold a current RSA.")).toBeInTheDocument();
  });

  it("lets an admin turn a document type off", async () => {
    vi.stubGlobal("fetch", mockFetch({ initial: ["RSA", "Food Handler"] }));
    render(<RequiredDocumentsTab />);
    await waitFor(() => expect(screen.getByLabelText("RSA")).toBeChecked());

    fireEvent.click(screen.getByLabelText("RSA"));

    await waitFor(() => expect(screen.getByLabelText("RSA")).not.toBeChecked());
    expect(screen.getByLabelText("Food Handler")).toBeChecked();
  });

  it("shows a plain-language error and leaves the selection unchanged when saving fails", async () => {
    vi.stubGlobal("fetch", mockFetch({ initial: [], onPut: () => ({ ok: false, body: {} }) }));
    render(<RequiredDocumentsTab />);
    await waitFor(() => expect(screen.getByLabelText("RSA")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("RSA"));

    await waitFor(() => expect(screen.getByText("Couldn't save that change. Try again.")).toBeInTheDocument());
    expect(screen.getByLabelText("RSA")).not.toBeChecked();
  });

  it("shows a plain-language error when the initial load fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response),
    );
    render(<RequiredDocumentsTab />);
    await waitFor(() =>
      expect(
        screen.getByText("We couldn't load your organisation's required documents. Please try again."),
      ).toBeInTheDocument(),
    );
  });
});

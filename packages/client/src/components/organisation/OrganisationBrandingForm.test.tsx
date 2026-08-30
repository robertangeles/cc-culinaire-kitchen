import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { OrganisationBrandingForm, type OrganisationSettings } from "./OrganisationBrandingForm.js";

const org: OrganisationSettings = {
  organisationId: 1,
  organisationName: "Almost French Patisserie",
  organisationLogoPath: null,
  organisationColorAccent: null,
  defaultTimezone: "Australia/Melbourne",
  defaultCurrency: "AUD",
  defaultJurisdiction: null,
};

function mockFetchOnce(response: { ok: boolean; json: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValueOnce(response);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("OrganisationBrandingForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves the current field values, always including the unchanged org name the shared PATCH schema requires", async () => {
    const onUpdated = vi.fn();
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ organisation: { ...org, defaultCurrency: "USD" } }),
    });
    render(<OrganisationBrandingForm org={org} onUpdated={onUpdated} />);

    fireEvent.change(screen.getByDisplayValue("AUD"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/organisations/1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            name: "Almost French Patisserie",
            colorAccent: "",
            defaultTimezone: "Australia/Melbourne",
            defaultCurrency: "USD",
            defaultJurisdiction: "",
          }),
        }),
      ),
    );
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith({ ...org, defaultCurrency: "USD" }));
    expect(screen.getByText("Organisation settings saved!")).toBeInTheDocument();
  });

  it("shows the server's error message when saving fails, and does not call onUpdated", async () => {
    const onUpdated = vi.fn();
    mockFetchOnce({ ok: false, json: async () => ({ error: "Invalid timezone" }) });
    render(<OrganisationBrandingForm org={org} onUpdated={onUpdated} />);

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/ }));

    await waitFor(() => expect(screen.getByText("Invalid timezone")).toBeInTheDocument());
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("selecting an accent colour twice deselects it (sent as empty string, not the color)", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => ({ organisation: org }) });
    render(<OrganisationBrandingForm org={org} onUpdated={vi.fn()} />);

    const swatches = document.querySelectorAll('button[style*="background-color"]');
    expect(swatches.length).toBeGreaterThan(0);
    const firstSwatch = swatches[0] as HTMLButtonElement;

    fireEvent.click(firstSwatch); // select
    fireEvent.click(firstSwatch); // deselect
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/organisations/1",
        expect.objectContaining({ body: expect.stringContaining('"colorAccent":""') }),
      ),
    );
  });

  it("uploads a logo and calls onUpdated with the returned organisation", async () => {
    const onUpdated = vi.fn();
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ organisation: { ...org, organisationLogoPath: "/uploads/logo.png" } }),
    });
    render(<OrganisationBrandingForm org={org} onUpdated={onUpdated} />);

    const file = new File(["fake-image-bytes"], "logo.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/organisations/1/logo", expect.objectContaining({ method: "POST" })),
    );
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith({ ...org, organisationLogoPath: "/uploads/logo.png" }));
    expect(screen.getByText("Logo updated!")).toBeInTheDocument();
  });

  it("shows the server's error message when a logo upload fails", async () => {
    mockFetchOnce({ ok: false, json: async () => ({ error: "File too large" }) });
    render(<OrganisationBrandingForm org={org} onUpdated={vi.fn()} />);

    const file = new File(["fake-image-bytes"], "huge.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("File too large")).toBeInTheDocument());
  });

  it("selecting no file is a no-op — no request is sent", () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<OrganisationBrandingForm org={org} onUpdated={vi.fn()} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

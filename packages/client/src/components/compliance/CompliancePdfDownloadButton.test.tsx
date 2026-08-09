import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CompliancePdfDownloadButton } from "./CompliancePdfDownloadButton.js";

/**
 * The one thing this control must never get wrong: it is gated on
 * compliance:read-all (nav-hiding is UX only, but there's no server
 * boundary to double up on inside a component test), and a failed
 * generation must read as plain language, never a raw status code.
 */

const hasPermissionMock = vi.fn();
vi.mock("../../hooks/useHasPermission.js", () => ({
  useHasPermission: () => hasPermissionMock,
}));

describe("CompliancePdfDownloadButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders nothing without compliance:read-all", () => {
    hasPermissionMock.mockReturnValue(false);
    render(<CompliancePdfDownloadButton />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the download control with compliance:read-all", () => {
    hasPermissionMock.mockReturnValue(true);
    render(<CompliancePdfDownloadButton />);
    expect(screen.getByRole("button", { name: "Download audit PDF" })).toBeInTheDocument();
  });

  it("clicking requests the report PDF and saves it", async () => {
    hasPermissionMock.mockReturnValue(true);
    const blob = new Blob(["pdf bytes"], { type: "application/pdf" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => 'attachment; filename="compliance-report-2026-08-09.pdf"' },
        blob: async () => blob,
      }) as unknown as Response),
    );
    // jsdom doesn't implement createObjectURL/anchor navigation — stub the
    // save step so the test asserts the request + resulting state, not DOM
    // internals the component doesn't own.
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<CompliancePdfDownloadButton />);
    fireEvent.click(screen.getByRole("button", { name: "Download audit PDF" }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/compliance/report.pdf", { credentials: "include" });
    expect(screen.getByRole("button", { name: "Download audit PDF" })).toBeEnabled();
  });

  it("shows a plain-language error when the download fails", async () => {
    hasPermissionMock.mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as Response));

    render(<CompliancePdfDownloadButton />);
    fireEvent.click(screen.getByRole("button", { name: "Download audit PDF" }));

    await waitFor(() =>
      expect(screen.getByText("Couldn't generate the report. Try again.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Download audit PDF" })).toBeEnabled();
  });
});

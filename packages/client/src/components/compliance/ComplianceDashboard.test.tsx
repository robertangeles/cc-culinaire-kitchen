import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

describe("ComplianceDashboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sends its requests to VITE_API_URL, like every sibling compliance component", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.example.test");
    vi.resetModules();
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { ComplianceDashboard } = await import("./ComplianceDashboard.js");
    render(<ComplianceDashboard />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.sort()).toEqual([
      "https://api.example.test/api/compliance/dashboard",
      "https://api.example.test/api/compliance/staff",
      "https://api.example.test/api/compliance/stats",
    ]);
  });
});

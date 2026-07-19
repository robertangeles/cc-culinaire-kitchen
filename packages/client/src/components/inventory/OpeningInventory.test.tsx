import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OpeningInventory } from "./OpeningInventory.js";

// OpeningInventory reads the selected location from LocationContext.
vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1", refreshLocations: vi.fn() }),
}));

const openingSession = {
  sessionId: "sess-1",
  sessionStatus: "OPEN",
  sessionType: "OPENING",
  openedDttm: "2026-07-19T01:00:00.000Z",
  flagReason: null,
  categories: [
    { categoryId: "cat-uuid-1", categoryName: "spirits", categoryStatus: "NOT_STARTED", lines: [] },
  ],
};

describe("OpeningInventory — claim before count", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn((url: string) => {
      if (url.includes("/stock-takes/active")) {
        return Promise.resolve({ ok: true, json: async () => openingSession });
      }
      if (url.includes("/claim")) {
        // Simulate the server rejecting the claim so we can also assert the
        // counter does NOT open on failure (fix B).
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "not found" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it("claims by category NAME (not id), and a failed claim does not open the counter", async () => {
    render(<OpeningInventory />);

    // Wait for the session to load and the Count button to render.
    const countBtn = await screen.findByRole("button", { name: /count/i });
    fireEvent.click(countBtn);

    // (A) the claim request must carry the category NAME, never the UUID.
    await waitFor(() => {
      const claimCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/claim"));
      expect(claimCall).toBeTruthy();
      expect(String(claimCall![0])).toContain("/categories/spirits/claim");
      expect(String(claimCall![0])).not.toContain("cat-uuid-1");
    });

    // (B) the claim failed, so the counter must NOT have opened.
    expect(screen.queryByText(/copy last count/i)).toBeNull();
  });
});

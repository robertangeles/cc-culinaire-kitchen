import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OpeningInventory } from "./OpeningInventory.js";

// OpeningInventory reads the selected location from LocationContext.
vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1", refreshLocations: vi.fn() }),
}));

// Finishing the opening count is a manager's call (inventory:manage on the server).
let isManager = true;
vi.mock("../../hooks/useHasPermission.js", () => ({
  useHasPermission: () => (key: string) => key === "inventory:manage" && isManager,
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

describe("OpeningInventory — finishing is a manager's call", () => {
  const counted = {
    ...openingSession,
    categories: [{ categoryId: "cat-uuid-1", categoryName: "spirits", categoryStatus: "SUBMITTED", lines: [] }],
  };

  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => counted })) as unknown as typeof fetch;
  });
  afterEach(() => {
    isManager = true;
    vi.restoreAllMocks();
  });

  it("shows a manager the Complete button", async () => {
    render(<OpeningInventory />);
    expect(await screen.findByRole("button", { name: /complete opening inventory/i })).toBeTruthy();
  });

  it("shows a counter that a manager finishes it, and no Complete button", async () => {
    isManager = false;
    render(<OpeningInventory />);
    expect(await screen.findByText(/a manager finishes the opening inventory/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /complete opening inventory/i })).toBeNull();
  });
});

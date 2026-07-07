import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { BrainTab } from "./BrainTab.js";

/**
 * BrainTab drives the Brain rollout flags via PUT /api/settings and reads a
 * health snapshot from GET /api/brain/stats. Both are mocked here so the
 * toggle/optimistic-update/revert behaviour is exercised without a server.
 */

const STATS = {
  flags: {
    brain_enabled: "false",
    brain_capture_enabled: "false",
    brain_recall_enabled: "false",
    brain_distillation_enabled: "false",
    brain_nudges_enabled: "false",
    brain_distillation_model: "anthropic/claude-haiku-4-5",
  },
  statusCounts: { ready: 3, pending: 1, failed: 0 },
  memoriesLast24h: 4,
  memoriesLast7d: 9,
  capture: { recorded: 4, skipped: 2, errors: 0 },
};

function mockFetch(impl: (url: string, init?: RequestInit) => unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = impl(url, init);
    return { ok: true, json: async () => body } as Response;
  });
}

describe("BrainTab", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch((url) => (url.includes("/api/brain/stats") ? STATS : { success: true })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the five flags and the health readout", async () => {
    render(<BrainTab />);
    await waitFor(() => expect(screen.getByText("Brain (master)")).toBeInTheDocument());
    expect(screen.getByText("Capture")).toBeInTheDocument();
    expect(screen.getByText("Distillation filter")).toBeInTheDocument();
    expect(screen.getByText("Recall")).toBeInTheDocument();
    expect(screen.getByText("Proactive nudges")).toBeInTheDocument();
    // Health readout reflects the stats payload.
    expect(screen.getByText("Ready").previousSibling).toHaveTextContent("3");
    expect(screen.getByText(/anthropic\/claude-haiku-4-5/)).toBeInTheDocument();
  });

  it("PUTs the single flag when the master toggle is flipped on", async () => {
    render(<BrainTab />);
    await waitFor(() => expect(screen.getByText("Brain (master)")).toBeInTheDocument());

    const masterSwitch = screen.getByRole("switch", { name: /Toggle Brain \(master\)/ });
    expect(masterSwitch).toHaveAttribute("aria-checked", "false");
    fireEvent.click(masterSwitch);

    await waitFor(() => {
      const putCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[1]?.method === "PUT",
      );
      expect(putCall).toBeTruthy();
      expect(putCall![0]).toContain("/api/settings");
      expect(JSON.parse(putCall![1].body)).toEqual({ brain_enabled: "true" });
    });
  });

  it("nudges toggle is disabled (Phase 3 not built)", async () => {
    render(<BrainTab />);
    await waitFor(() => expect(screen.getByText("Proactive nudges")).toBeInTheDocument());
    expect(screen.getByRole("switch", { name: /Toggle Proactive nudges/ })).toBeDisabled();
  });

  it("reverts the toggle and shows an error when the PUT fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return { ok: false, json: async () => ({ error: "nope" }) } as Response;
        }
        return { ok: true, json: async () => STATS } as Response;
      }),
    );
    render(<BrainTab />);
    await waitFor(() => expect(screen.getByText("Brain (master)")).toBeInTheDocument());

    const masterSwitch = screen.getByRole("switch", { name: /Toggle Brain \(master\)/ });
    fireEvent.click(masterSwitch);

    await waitFor(() => expect(screen.getByText("nope")).toBeInTheDocument());
    // Reverted back to off.
    expect(masterSwitch).toHaveAttribute("aria-checked", "false");
  });
});

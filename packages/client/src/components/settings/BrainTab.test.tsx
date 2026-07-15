import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    brain_compaction_enabled: "false",
    brain_compaction_cap: "0",
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

  it("renders the six flags and the health readout", async () => {
    render(<BrainTab />);
    await waitFor(() => expect(screen.getByText("Brain (master)")).toBeInTheDocument());
    expect(screen.getByText("Capture")).toBeInTheDocument();
    expect(screen.getByText("Distillation filter")).toBeInTheDocument();
    expect(screen.getByText("Recall")).toBeInTheDocument();
    expect(screen.getByText("Proactive nudges")).toBeInTheDocument();
    expect(screen.getByText("Compaction")).toBeInTheDocument();
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

  it("nudges toggle is interactive once the master flag is on (T17 shipped)", async () => {
    render(<BrainTab />);
    await waitFor(() => expect(screen.getByText("Proactive nudges")).toBeInTheDocument());
    expect(screen.getByRole("switch", { name: /Toggle Proactive nudges/ })).toBeEnabled();
  });

  it("compaction cap input saves brain_compaction_cap on blur", async () => {
    render(<BrainTab />);
    await waitFor(() => expect(screen.getByText("Compaction")).toBeInTheDocument());
    const cap = screen.getByLabelText("Compaction cap");
    fireEvent.change(cap, { target: { value: "50" } });
    fireEvent.blur(cap);
    await waitFor(() => {
      const putCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[1]?.method === "PUT",
      );
      expect(putCall).toBeTruthy();
      expect(JSON.parse(putCall![1].body)).toEqual({ brain_compaction_cap: "50" });
    });
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

  it("shows the re-embed button when memories failed and requeues them (T18)", async () => {
    const statsFailed = { ...STATS, statusCounts: { ready: 3, pending: 1, failed: 2 } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/brain/reembed-failed")) {
          return { ok: true, json: async () => ({ requeued: 2 }) } as Response;
        }
        if (String(url).includes("/api/brain/stats")) {
          return { ok: true, json: async () => statsFailed } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }),
    );
    render(<BrainTab />);
    const btn = await screen.findByRole("button", { name: /re-embed failed/i });
    fireEvent.click(btn);
    await waitFor(() => {
      const called = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
        (c) => String(c[0]).includes("/api/brain/reembed-failed") && c[1]?.method === "POST",
      );
      expect(called).toBe(true);
    });
    await waitFor(() => expect(screen.getByText(/requeued 2 memories/i)).toBeInTheDocument());
  });
});

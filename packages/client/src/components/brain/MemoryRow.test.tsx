import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRow } from "./MemoryRow.js";
import type { BrainMemory } from "../../hooks/useBrainMemories.js";

function makeMemory(overrides: Partial<BrainMemory> = {}): BrainMemory {
  return {
    memoryId: "m1",
    title: "Prefers gluten-free",
    body: "The chef prefers gluten-free substitutions.",
    sourceType: "chat",
    scope: "user",
    isPinned: false,
    status: "ready",
    createdDttm: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("MemoryRow (T14b actions)", () => {
  const handlers = () => ({
    onDelete: vi.fn(async () => true),
    onPin: vi.fn(async () => true),
    onCorrect: vi.fn(async () => true),
    onToggleScope: vi.fn(async () => true),
  });

  beforeEach(() => vi.clearAllMocks());

  it("pins via onPin with the toggled value", async () => {
    const h = handlers();
    render(<MemoryRow memory={makeMemory()} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: /pin this memory/i }));
    await waitFor(() => expect(h.onPin).toHaveBeenCalledWith("m1", true));
  });

  it("shows a pinned star and a shared badge from memory state", () => {
    render(<MemoryRow memory={makeMemory({ isPinned: true, scope: "org" })} {...handlers()} />);
    expect(screen.getByLabelText(/pinned/i)).toBeInTheDocument();
    expect(screen.getByText(/shared/i)).toBeInTheDocument();
  });

  it("edits inline: reveals a textarea and saves via onCorrect", async () => {
    const h = handlers();
    render(<MemoryRow memory={makeMemory()} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: /edit this memory/i }));
    const textarea = screen.getByLabelText(/edit memory text/i);
    fireEvent.change(textarea, { target: { value: "corrected text" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(h.onCorrect).toHaveBeenCalledWith("m1", "corrected text"));
  });

  it("hides the share action when the user has no kitchen, shows it when they do", () => {
    const { rerender } = render(<MemoryRow memory={makeMemory()} hasOrg={false} {...handlers()} />);
    expect(screen.queryByRole("button", { name: /share with your kitchen/i })).toBeNull();
    rerender(<MemoryRow memory={makeMemory()} hasOrg {...handlers()} />);
    expect(screen.getByRole("button", { name: /share with your kitchen/i })).toBeInTheDocument();
  });

  it("shares a private memory via onToggleScope('org')", async () => {
    const h = handlers();
    render(<MemoryRow memory={makeMemory()} hasOrg {...h} />);
    fireEvent.click(screen.getByRole("button", { name: /share with your kitchen/i }));
    await waitFor(() => expect(h.onToggleScope).toHaveBeenCalledWith("m1", "org"));
  });

  it("un-shares a shared memory via onToggleScope('user')", async () => {
    const h = handlers();
    render(<MemoryRow memory={makeMemory({ scope: "org" })} hasOrg {...h} />);
    fireEvent.click(screen.getByRole("button", { name: /un-share/i }));
    await waitFor(() => expect(h.onToggleScope).toHaveBeenCalledWith("m1", "user"));
  });
});

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrainGroundedChip } from "./BrainGroundedChip.js";

/**
 * The chip has two sources (spec T14): chat `annotations` and the Labs' direct
 * `memories` prop. Both must drive the same pill; empty/missing input renders
 * nothing.
 */
describe("BrainGroundedChip", () => {
  const memories = [
    { memoryId: "m1", title: "Miso Glazed Cod", sourceType: "recipe" },
    { memoryId: "m2", title: null, sourceType: "chat" },
  ];

  it("renders from a direct memories prop (Labs path) and reveals titles on expand", () => {
    render(<BrainGroundedChip memories={memories} />);
    const toggle = screen.getByRole("button", { name: /grounded in your brain/i });
    expect(toggle).toBeInTheDocument();
    // Titles hidden until expanded.
    expect(screen.queryByText(/Miso Glazed Cod/)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText(/Miso Glazed Cod/)).toBeInTheDocument();
    // Null-title memory falls back to a friendly label.
    expect(screen.getByText(/A note from your kitchen/)).toBeInTheDocument();
  });

  it("renders nothing for empty or missing memories", () => {
    const { container: c1 } = render(<BrainGroundedChip memories={[]} />);
    expect(c1).toBeEmptyDOMElement();
    const { container: c2 } = render(<BrainGroundedChip memories={null} />);
    expect(c2).toBeEmptyDOMElement();
    const { container: c3 } = render(<BrainGroundedChip />);
    expect(c3).toBeEmptyDOMElement();
  });

  it("still renders from chat annotations (backward-compat)", () => {
    const annotations = [{ type: "brain_grounded", memories }];
    render(<BrainGroundedChip annotations={annotations} />);
    expect(screen.getByRole("button", { name: /grounded in your brain/i })).toBeInTheDocument();
  });

  it("can be dismissed", () => {
    const { container } = render(<BrainGroundedChip memories={memories} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(container).toBeEmptyDOMElement();
  });
});

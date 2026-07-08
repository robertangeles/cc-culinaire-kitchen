import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScopeToggle } from "./ScopeToggle.js";

describe("ScopeToggle (D-T4 scope tabs)", () => {
  it("renders two tabs and marks the active one selected", () => {
    render(<ScopeToggle value="user" onChange={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /private to you/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /shared with your kitchen/i })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onChange with the other scope when clicked", () => {
    const onChange = vi.fn();
    render(<ScopeToggle value="user" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /shared with your kitchen/i }));
    expect(onChange).toHaveBeenCalledWith("org");
  });
});

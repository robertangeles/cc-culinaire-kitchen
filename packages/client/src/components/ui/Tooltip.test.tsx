import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Tooltip } from "./Tooltip.js";

describe("Tooltip", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows after the delay when hovered", () => {
    vi.useFakeTimers();
    render(
      <Tooltip text="Help text">
        <button>Target</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Help text");
  });

  // A click fires mouseenter AND focus. Each used to start its own timer and only the
  // latest was cancelled on leave, so the first one opened the tooltip after the pointer
  // had already left, leaving it stuck open.
  it("stays hidden when the pointer leaves after a hover plus focus", () => {
    vi.useFakeTimers();
    render(
      <Tooltip text="Help text">
        <button>Target</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button");
    fireEvent.mouseEnter(button);
    fireEvent.focus(button);
    fireEvent.mouseLeave(button);
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

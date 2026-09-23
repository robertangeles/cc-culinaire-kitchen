import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RuleDrawer } from "./RuleDrawer.js";

/**
 * The drawer is new UI this app hasn't built before (no existing
 * modal/dialog in this codebase has real keyboard/focus handling), so its
 * a11y contract is tested explicitly rather than assumed from precedent.
 */

function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div>
      <button type="button">Open Drawer</button>
      {open && (
        <RuleDrawer
          open={open}
          title="Test Drawer"
          onClose={onClose}
          footer={
            <>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="button">Save</button>
            </>
          }
        >
          <input type="text" aria-label="First field" />
          <input type="text" aria-label="Second field" />
        </RuleDrawer>
      )}
    </div>
  );
}

describe("RuleDrawer", () => {
  it("moves focus to the first focusable element on open", async () => {
    render(<Harness open={true} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("First field")).toHaveFocus());
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("traps Tab inside the drawer — Tab from the last element (Save) wraps to the first (the header's Close button)", async () => {
    render(<Harness open={true} onClose={vi.fn()} />);
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toHaveFocus());
  });

  it("traps Shift+Tab inside the drawer — Shift+Tab from the first element (Close) wraps to the last (Save)", async () => {
    render(<Harness open={true} onClose={vi.fn()} />);
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toHaveFocus());
  });

  it("returns focus to the triggering element on close", async () => {
    function ReturnFocusHarness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <RuleDrawer
              open={open}
              title="Test"
              onClose={() => setOpen(false)}
              footer={<button type="button">Save</button>}
            >
              <input type="text" aria-label="Field" />
            </RuleDrawer>
          )}
        </div>
      );
    }
    render(<ReturnFocusHarness />);
    const openButton = screen.getByRole("button", { name: "Open" });
    openButton.focus(); // jsdom's fireEvent.click doesn't reliably move focus like a real browser click does
    fireEvent.click(openButton);
    await waitFor(() => expect(screen.getByLabelText("Field")).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(openButton).toHaveFocus());
  });
});

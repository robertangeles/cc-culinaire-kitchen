import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill, type StatusPillVariant } from "./StatusPill.js";

/**
 * Status must never be colour-only — the word itself has to render, and
 * when a fuller ariaLabel is given ("RSA: expired 15 June 2026") it must
 * reach the DOM so a screen reader announces more than the bare word.
 */
describe("StatusPill", () => {
  it("renders the status word as visible text, not colour alone", () => {
    render(<StatusPill variant="expired">Expired</StatusPill>);
    expect(screen.getByText("Expired")).toBeTruthy();
  });

  it("carries an ariaLabel with document + status + date when given", () => {
    render(
      <StatusPill variant="expired" ariaLabel="RSA: expired 15 June 2026">
        Expired
      </StatusPill>,
    );
    expect(screen.getByText("Expired")).toHaveAttribute("aria-label", "RSA: expired 15 June 2026");
  });

  it("has no aria-label when none is given", () => {
    render(<StatusPill variant="compliant">Compliant</StatusPill>);
    expect(screen.getByText("Compliant")).not.toHaveAttribute("aria-label");
  });

  it("renders every variant with its own visible text", () => {
    const variants: StatusPillVariant[] = ["compliant", "expiring", "expired", "pending", "rejected", "na"];
    for (const variant of variants) {
      const { unmount } = render(<StatusPill variant={variant}>{variant}</StatusPill>);
      expect(screen.getByText(variant)).toBeTruthy();
      unmount();
    }
  });
});

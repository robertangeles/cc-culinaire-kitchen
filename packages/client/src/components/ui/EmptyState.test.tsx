import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Brain, SearchX } from "lucide-react";
import { EmptyState } from "./EmptyState.js";

/**
 * invitation and no-match are different things, not the same component
 * with a colour swap (see components/brain/BrainEmptyState.tsx): invitation
 * gets the warm glow treatment, no-match stays calm. Both must still fire
 * their action when one is supplied.
 */
describe("EmptyState", () => {
  it("renders the invitation variant with its warm glow ring", () => {
    render(
      <EmptyState
        icon={Brain}
        title="Your Brain is warming up"
        body="Keep cooking and chatting."
        variant="invitation"
      />,
    );
    const iconWrapper = screen.getByText("Your Brain is warming up").parentElement?.querySelector("div");
    expect(iconWrapper?.className).toContain("shadow-");
  });

  it("renders the no-match variant without the glow", () => {
    render(
      <EmptyState icon={SearchX} title="No memories match" body="Clear the filters." variant="no-match" />,
    );
    const iconWrapper = screen.getByText("No memories match").parentElement?.querySelector("div");
    expect(iconWrapper?.className).not.toContain("shadow-");
  });

  it("fires the action when clicked", () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon={Brain}
        title="Nothing here"
        body="Get started."
        action={{ label: "Upload a document", onClick }}
      />,
    );
    screen.getByText("Upload a document").click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders no action when none is given", () => {
    render(<EmptyState icon={Brain} title="Nothing here" body="Get started." />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

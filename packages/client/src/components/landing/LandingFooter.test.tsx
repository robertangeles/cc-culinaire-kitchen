import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { LandingFooter } from "./LandingFooter.js";

describe("LandingFooter", () => {
  it("links Contact to the published address", () => {
    render(
      <MemoryRouter>
        <LandingFooter />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Contact" }).getAttribute("href")).toBe("mailto:rob.angeles@passeculinaire.com");
  });
});

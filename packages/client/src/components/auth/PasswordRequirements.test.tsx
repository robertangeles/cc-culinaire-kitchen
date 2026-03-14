import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PasswordRequirements, isPasswordValid } from "./PasswordRequirements.js";

describe("isPasswordValid", () => {
  it("rejects short passwords", () => {
    expect(isPasswordValid("Ab1")).toBe(false);
  });

  it("rejects passwords without uppercase", () => {
    expect(isPasswordValid("abcdefg1")).toBe(false);
  });

  it("rejects passwords without a number", () => {
    expect(isPasswordValid("Abcdefgh")).toBe(false);
  });

  it("accepts valid passwords", () => {
    expect(isPasswordValid("Abcdefg1")).toBe(true);
  });
});

describe("PasswordRequirements", () => {
  it("renders nothing when password is empty", () => {
    const { container } = render(<PasswordRequirements password="" />);
    expect(container.innerHTML).toBe("");
  });

  it("shows all rules when password is entered", () => {
    render(<PasswordRequirements password="a" />);
    expect(screen.getByText("At least 8 characters")).toBeInTheDocument();
    expect(screen.getByText("At least one uppercase letter")).toBeInTheDocument();
    expect(screen.getByText("At least one number")).toBeInTheDocument();
  });
});

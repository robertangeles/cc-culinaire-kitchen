// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Text as RNText } from "react-native";
import { Screen, COLUMN_WIDTH } from "../src/ui/Screen";

afterEach(cleanup);

// react-native-web writes each style as a CSS rule in the document, so the cascade can be read back at any window width.
const widthOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).maxWidth);

describe("tablet width", () => {
  it.each([
    ["an iPad (portrait)", 820, 1180],
    ["an iPad (landscape)", 1180, 820],
    ["a phone", 390, 844],
  ])("keeps a screen's content in one centred column on %s", (_name, width, height) => {
    window.innerWidth = width;
    window.innerHeight = height;
    render(
      <Screen>
        <RNText>Join your kitchen</RNText>
      </Screen>,
    );
    const column = screen.getByText("Join your kitchen").parentElement as HTMLElement;
    expect(widthOf(column)).toBe(COLUMN_WIDTH);
    expect(getComputedStyle(column).width).toBe("100%");
    // The scroll area centres the column, so a wider window leaves equal paper on both sides.
    expect(getComputedStyle(column.parentElement as HTMLElement).alignItems).toBe("center");
  });

  it("is a column no wider than a comfortable line of text", () => {
    expect(COLUMN_WIDTH).toBeLessThanOrEqual(600);
  });
});

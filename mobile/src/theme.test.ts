import { describe, it, expect } from "vitest";
import { palettes, fontSize, size, type Palette } from "./theme";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every text-on-background pair the screens use, per theme. Status is also never colour alone (icon or words). */
const pairs = (p: Palette): Array<[string, string, string]> => [
  ["text on bg", p.text, p.bg],
  ["text on surface", p.text, p.surface],
  ["muted text on bg", p.textMuted, p.bg],
  ["muted text on surface", p.textMuted, p.surface],
  ["accent text on bg", p.accentText, p.bg],
  ["accent text on surface", p.accentText, p.surface],
  ["success on bg", p.success, p.bg],
  ["success on surface", p.success, p.surface],
  ["danger on bg", p.danger, p.bg],
  ["danger on surface", p.danger, p.surface],
  ["button text on gradient start", p.buttonText, p.buttonFrom],
  ["button text on gradient end", p.buttonText, p.buttonTo],
  ["text on warning fill", p.onWarning, p.warningFill],
];

describe.each(Object.entries(palettes))("%s theme contrast", (_name, palette) => {
  it.each(pairs(palette))("%s is at least 4.5:1", (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("size rules", () => {
  it("keeps text at 16pt or more and taps at 56dp or more", () => {
    expect(Math.min(...Object.values(fontSize))).toBeGreaterThanOrEqual(16);
    expect(size.tap).toBeGreaterThanOrEqual(56);
    expect(size.key).toBeGreaterThanOrEqual(72);
  });
});

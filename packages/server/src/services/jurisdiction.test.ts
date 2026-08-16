import { describe, it, expect } from "vitest";
import { normalizeJurisdiction } from "./jurisdiction.js";

describe("normalizeJurisdiction", () => {
  it("passes through an already-correct 3-letter code", () => {
    expect(normalizeJurisdiction("VIC")).toBe("VIC");
  });

  it("maps a full state name to its code", () => {
    expect(normalizeJurisdiction("Victoria")).toBe("VIC");
    expect(normalizeJurisdiction("New South Wales")).toBe("NSW");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(normalizeJurisdiction("  victoria  ")).toBe("VIC");
    expect(normalizeJurisdiction("nsw")).toBe("NSW");
  });

  it("keeps ACT distinct from NSW, unlike the IANA timezone mapping", () => {
    expect(normalizeJurisdiction("Australian Capital Territory")).toBe("ACT");
    expect(normalizeJurisdiction("ACT")).toBe("ACT");
  });

  it("covers every AU state and territory", () => {
    expect(normalizeJurisdiction("Tasmania")).toBe("TAS");
    expect(normalizeJurisdiction("Queensland")).toBe("QLD");
    expect(normalizeJurisdiction("South Australia")).toBe("SA");
    expect(normalizeJurisdiction("Western Australia")).toBe("WA");
    expect(normalizeJurisdiction("Northern Territory")).toBe("NT");
  });

  it("returns unrecognised input trimmed/uppercased rather than null, so it still participates in exact-match lookups", () => {
    expect(normalizeJurisdiction("Wonderland")).toBe("WONDERLAND");
  });

  it("null/undefined/empty all return null", () => {
    expect(normalizeJurisdiction(null)).toBeNull();
    expect(normalizeJurisdiction(undefined)).toBeNull();
    expect(normalizeJurisdiction("")).toBeNull();
    expect(normalizeJurisdiction("   ")).toBeNull();
  });
});

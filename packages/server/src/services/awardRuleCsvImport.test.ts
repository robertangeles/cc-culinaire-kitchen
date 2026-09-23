import { describe, it, expect } from "vitest";
import { previewAwardRuleCsv } from "./awardRuleCsvImport.js";

describe("previewAwardRuleCsv — parse + validate (no DB)", () => {
  it("parses a valid row with a real jurisdiction", () => {
    const preview = previewAwardRuleCsv("MA000009,max_ordinary_hours,NSW,38,2026-07-01,cl 32");
    expect(preview.valid).toEqual([
      {
        rowIndex: 1,
        awardCode: "MA000009",
        ruleType: "max_ordinary_hours",
        jurisdiction: "NSW",
        thresholdValue: 38,
        effectiveFrom: "2026-07-01",
        sourceCitation: "cl 32",
      },
    ]);
    expect(preview.invalid).toEqual([]);
  });

  it("treats a blank jurisdiction as national (null)", () => {
    const preview = previewAwardRuleCsv("MA000009,publish_notice,,168,2026-07-01,");
    expect(preview.valid[0].jurisdiction).toBeNull();
    expect(preview.valid[0].sourceCitation).toBeNull();
  });

  it("skips a header row", () => {
    const preview = previewAwardRuleCsv(
      "Award Code,Rule Type,Jurisdiction,Threshold,Effective From,Source\nMA000009,max_ordinary_hours,NSW,38,2026-07-01,",
    );
    expect(preview.valid).toHaveLength(1);
  });

  it("skips blank lines", () => {
    const preview = previewAwardRuleCsv("MA000009,max_ordinary_hours,NSW,38,2026-07-01,\n\n\n");
    expect(preview.valid).toHaveLength(1);
  });

  it("rejects a missing awardCode", () => {
    const preview = previewAwardRuleCsv(",max_ordinary_hours,NSW,38,2026-07-01,");
    expect(preview.valid).toEqual([]);
    expect(preview.invalid).toEqual([{ rowIndex: 1, reason: "missing awardCode" }]);
  });

  it("rejects an unrecognized rule type", () => {
    const preview = previewAwardRuleCsv("MA000009,made_up_type,NSW,38,2026-07-01,");
    expect(preview.invalid[0].reason).toMatch(/unrecognized ruleType/);
  });

  it("rejects a jurisdiction that isn't a real AU code — the exact typo case ('NWS' vs 'NSW')", () => {
    const preview = previewAwardRuleCsv("MA000009,max_ordinary_hours,NWS,38,2026-07-01,");
    expect(preview.invalid[0].reason).toMatch(/unrecognized jurisdiction code: NWS/);
  });

  it("rejects a non-numeric thresholdValue", () => {
    const preview = previewAwardRuleCsv("MA000009,max_ordinary_hours,NSW,not-a-number,2026-07-01,");
    expect(preview.invalid[0].reason).toMatch(/thresholdValue must be a positive number/);
  });

  it("rejects a zero or negative thresholdValue", () => {
    const preview = previewAwardRuleCsv("MA000009,max_ordinary_hours,NSW,0,2026-07-01,\nMA000009,max_ordinary_hours,VIC,-5,2026-07-01,");
    expect(preview.invalid).toHaveLength(2);
  });

  it("rejects an unparseable effectiveFrom date", () => {
    const preview = previewAwardRuleCsv("MA000009,max_ordinary_hours,NSW,38,not-a-date,");
    expect(preview.invalid[0].reason).toMatch(/effectiveFrom is missing or unparseable/);
  });

  it("processes a mixed file — valid and invalid rows don't affect each other's rowIndex", () => {
    const preview = previewAwardRuleCsv(
      [
        "MA000009,max_ordinary_hours,NSW,38,2026-07-01,",
        "MA000009,made_up_type,NSW,38,2026-07-01,",
        "MA000009,publish_notice,VIC,168,2026-07-01,",
      ].join("\n"),
    );
    expect(preview.valid).toHaveLength(2);
    expect(preview.invalid).toHaveLength(1);
    expect(preview.invalid[0].rowIndex).toBe(2);
    expect(preview.valid.map((r) => r.rowIndex)).toEqual([1, 3]);
  });

  it("throws if the file has zero data rows", () => {
    expect(() => previewAwardRuleCsv("")).toThrow(/no data rows/);
    expect(() => previewAwardRuleCsv("Award Code,Rule Type,Jurisdiction,Threshold,Effective From,Source")).toThrow(
      /no data rows/,
    );
  });

  it("throws if the file exceeds the 1000-row cap", () => {
    const rows = Array.from({ length: 1001 }, () => "MA000009,max_ordinary_hours,NSW,38,2026-07-01,").join("\n");
    expect(() => previewAwardRuleCsv(rows)).toThrow(/1000-row limit/);
  });

  it("accepts exactly 1000 rows (the boundary itself is not exceeding)", () => {
    const rows = Array.from({ length: 1000 }, () => "MA000009,max_ordinary_hours,NSW,38,2026-07-01,").join("\n");
    expect(() => previewAwardRuleCsv(rows)).not.toThrow();
  });
});

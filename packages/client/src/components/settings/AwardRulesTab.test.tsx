import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listAwardRules = vi.fn();
const upsertAwardRule = vi.fn();
const previewAwardRuleCsv = vi.fn();
const commitAwardRuleCsvImport = vi.fn();

vi.mock("../../hooks/useRoster.js", async () => {
  const actual = await vi.importActual<typeof import("../../hooks/useRoster.js")>("../../hooks/useRoster.js");
  return {
    ...actual,
    listAwardRules: (...args: unknown[]) => listAwardRules(...args),
    upsertAwardRule: (...args: unknown[]) => upsertAwardRule(...args),
    previewAwardRuleCsv: (...args: unknown[]) => previewAwardRuleCsv(...args),
    commitAwardRuleCsvImport: (...args: unknown[]) => commitAwardRuleCsvImport(...args),
  };
});

const { AwardRulesTab } = await import("./AwardRulesTab.js");

describe("AwardRulesTab", () => {
  beforeEach(() => {
    previewAwardRuleCsv.mockReset();
    commitAwardRuleCsvImport.mockReset();
    listAwardRules.mockReset();
    upsertAwardRule.mockReset();
  });

  it("shows an inviting empty state with no rules, and only ONE Add Rule CTA (no second disabled card)", async () => {
    listAwardRules.mockResolvedValue([]);
    render(<AwardRulesTab />);
    await waitFor(() => expect(screen.getByText("No award rules yet")).toBeInTheDocument());
    expect(screen.getByText(/Add your first rule to get started/)).toBeInTheDocument();
    // Exactly one "Add Rule" affordance — the header button.
    expect(screen.getAllByRole("button", { name: /Add Rule/i })).toHaveLength(1);
  });

  it("renders existing rules in the table with National shown for a null jurisdiction", async () => {
    listAwardRules.mockResolvedValue([
      {
        awardRuleId: "r1",
        awardCode: "MA000009",
        ruleType: "max_ordinary_hours",
        jurisdiction: null,
        thresholdValue: "38",
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
        sourceCitation: "cl 32",
        ruleVersion: "v2026-07-01",
      },
    ]);
    render(<AwardRulesTab />);
    await waitFor(() => expect(screen.getByText("MA000009")).toBeInTheDocument());
    expect(screen.getByText("National")).toBeInTheDocument();
    expect(screen.getByText("Max Ordinary Hours")).toBeInTheDocument();
  });

  it("shows a retry banner when the list fails to load", async () => {
    listAwardRules.mockRejectedValue(new Error("network error"));
    render(<AwardRulesTab />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("creates a new rule via the drawer and refreshes the list", async () => {
    listAwardRules.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        awardRuleId: "r1",
        awardCode: "MA000009",
        ruleType: "max_ordinary_hours",
        jurisdiction: null,
        thresholdValue: "38",
        effectiveFrom: "2026-07-01",
        effectiveTo: null,
        sourceCitation: null,
        ruleVersion: "v2026-07-01",
      },
    ]);
    upsertAwardRule.mockResolvedValue({});

    render(<AwardRulesTab />);
    await waitFor(() => expect(screen.getByText("No award rules yet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Add Rule/i }));
    await waitFor(() => expect(screen.getByLabelText("Award Code")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Threshold Value"), { target: { value: "38" } });
    fireEvent.change(screen.getByLabelText("Effective From"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(upsertAwardRule).toHaveBeenCalledWith(
      expect.objectContaining({ awardCode: "MA000009", thresholdValue: 38, effectiveFrom: "2026-07-01" }),
    ));
    await waitFor(() => expect(screen.getByText("MA000009")).toBeInTheDocument());
  });

  it("keeps the drawer open with an inline error, form values intact, when the save fails", async () => {
    listAwardRules.mockResolvedValue([]);
    upsertAwardRule.mockRejectedValue(new Error("This rule was already updated today"));

    render(<AwardRulesTab />);
    await waitFor(() => expect(screen.getByText("No award rules yet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Add Rule/i }));
    await waitFor(() => expect(screen.getByLabelText("Threshold Value")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Threshold Value"), { target: { value: "38" } });
    fireEvent.change(screen.getByLabelText("Effective From"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("This rule was already updated today")).toBeInTheDocument());
    // Drawer is still open and the field value the user typed survived.
    expect(screen.getByLabelText("Threshold Value")).toHaveValue(38);
  });

  it("rejects a non-positive threshold client-side before ever calling upsertAwardRule", async () => {
    listAwardRules.mockResolvedValue([]);
    render(<AwardRulesTab />);
    await waitFor(() => expect(screen.getByText("No award rules yet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Add Rule/i }));
    await waitFor(() => expect(screen.getByLabelText("Effective From")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Threshold Value"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Effective From"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText(/positive number/)).toBeInTheDocument());
    expect(upsertAwardRule).not.toHaveBeenCalled();
  });

  describe("CSV import", () => {
    function csvFile(content = "MA000009,max_ordinary_hours,NSW,38,2026-07-01,") {
      return new File([content], "rules.csv", { type: "text/csv" });
    }

    it("shows the preview (valid + invalid rows) after selecting a file", async () => {
      listAwardRules.mockResolvedValue([]);
      previewAwardRuleCsv.mockResolvedValue({
        valid: [
          { rowIndex: 1, awardCode: "MA000009", ruleType: "max_ordinary_hours", jurisdiction: "NSW", thresholdValue: 38, effectiveFrom: "2026-07-01", sourceCitation: null },
        ],
        invalid: [{ rowIndex: 2, reason: "unrecognized jurisdiction code: NWS" }],
      });

      render(<AwardRulesTab />);
      await waitFor(() => expect(screen.getByText("No award rules yet")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /Import CSV/i }));
      const input = await screen.findByLabelText("CSV file");
      fireEvent.change(input, { target: { files: [csvFile()] } });

      await waitFor(() => expect(screen.getByText("1 valid, 1 invalid.")).toBeInTheDocument());
      expect(screen.getByText(/Row 2: unrecognized jurisdiction code: NWS/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Import 1 row" })).toBeInTheDocument();
    });

    it("commits the valid rows and shows the result, then refreshes the list", async () => {
      listAwardRules.mockResolvedValueOnce([]).mockResolvedValueOnce([
        { awardRuleId: "r1", awardCode: "MA000009", ruleType: "max_ordinary_hours", jurisdiction: "NSW", thresholdValue: "38", effectiveFrom: "2026-07-01", effectiveTo: null, sourceCitation: null, ruleVersion: "v2026-07-01" },
      ]);
      previewAwardRuleCsv.mockResolvedValue({
        valid: [
          { rowIndex: 1, awardCode: "MA000009", ruleType: "max_ordinary_hours", jurisdiction: "NSW", thresholdValue: 38, effectiveFrom: "2026-07-01", sourceCitation: null },
        ],
        invalid: [],
      });
      commitAwardRuleCsvImport.mockResolvedValue({ imported: 1, skipped: 0, errors: [] });

      render(<AwardRulesTab />);
      await waitFor(() => expect(screen.getByText("No award rules yet")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /Import CSV/i }));
      const input = await screen.findByLabelText("CSV file");
      fireEvent.change(input, { target: { files: [csvFile()] } });
      await waitFor(() => expect(screen.getByRole("button", { name: "Import 1 row" })).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: "Import 1 row" }));

      await waitFor(() => expect(screen.getByText("Imported 1, skipped 0.")).toBeInTheDocument());
      expect(commitAwardRuleCsvImport).toHaveBeenCalledWith([
        expect.objectContaining({ awardCode: "MA000009", jurisdiction: "NSW" }),
      ]);
      await waitFor(() => expect(screen.getByText("MA000009")).toBeInTheDocument());
    });

    it("shows an inline error if the preview request itself fails (e.g. row-cap exceeded)", async () => {
      listAwardRules.mockResolvedValue([]);
      previewAwardRuleCsv.mockRejectedValue(new Error("The CSV file has 1001 rows, exceeding the 1000-row limit"));

      render(<AwardRulesTab />);
      await waitFor(() => expect(screen.getByText("No award rules yet")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: /Import CSV/i }));
      const input = await screen.findByLabelText("CSV file");
      fireEvent.change(input, { target: { files: [csvFile()] } });

      await waitFor(() => expect(screen.getByText(/1000-row limit/)).toBeInTheDocument());
    });
  });
});

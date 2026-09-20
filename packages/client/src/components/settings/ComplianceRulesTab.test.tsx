import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ComplianceRulesTab } from "./ComplianceRulesTab.js";

/**
 * This tab exercises GET/PUT /api/compliance/rules end to end for the
 * first time (both previously orphan routes — no client caller existed
 * before this component). Active-row filtering (Section 11 design
 * decision) is asserted explicitly since the server's listExpiryRules
 * intentionally returns full history, not just active rows.
 */

function mockFetch(options: {
  initial?: unknown[];
  onPut?: (body: unknown) => { ok: boolean; status?: number; body: unknown };
}) {
  const initial = options.initial ?? [];
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(init.body as string);
      const result = options.onPut?.(body) ?? { ok: true, status: 200, body };
      return { ok: result.ok, status: result.status ?? 200, json: async () => result.body } as Response;
    }
    return { ok: true, json: async () => initial } as Response;
  });
}

describe("ComplianceRulesTab", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows an inviting empty state with no rules", async () => {
    vi.stubGlobal("fetch", mockFetch({ initial: [] }));
    render(<ComplianceRulesTab />);
    await waitFor(() => expect(screen.getByText("No expiry rules yet")).toBeInTheDocument());
    expect(screen.getByText(/Add your first rule to get started/)).toBeInTheDocument();
  });

  it("shows only ACTIVE rows in the table — a closed (superseded) row is excluded", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        initial: [
          {
            documentExpiryRuleId: "old",
            documentType: "RSA",
            jurisdiction: null,
            validityPeriodYears: 3,
            blockRosterOnExpiry: true,
            trainingProviderUrl: null,
            effectiveFrom: "2020-01-01",
            effectiveTo: "2025-12-31", // closed — must not render
            sourceCitation: null,
            notes: null,
            alertDays: [],
          },
          {
            documentExpiryRuleId: "current",
            documentType: "RSA",
            jurisdiction: null,
            validityPeriodYears: 3,
            blockRosterOnExpiry: true,
            trainingProviderUrl: null,
            effectiveFrom: "2026-01-01",
            effectiveTo: null, // active
            sourceCitation: null,
            notes: null,
            alertDays: [],
          },
        ],
      }),
    );
    render(<ComplianceRulesTab />);
    await waitFor(() => expect(screen.getAllByText("RSA")).toHaveLength(1));
  });

  it("shows a retry banner when the list fails to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response),
    );
    render(<ComplianceRulesTab />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("creates a new rule via the drawer and refreshes the list", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return { ok: true, json: async () => ({}) } as Response;
        }
        callCount += 1;
        if (callCount === 1) return { ok: true, json: async () => [] } as Response;
        return {
          ok: true,
          json: async () => [
            {
              documentExpiryRuleId: "new",
              documentType: "Food Handler",
              jurisdiction: null,
              validityPeriodYears: null,
              blockRosterOnExpiry: false,
              trainingProviderUrl: null,
              effectiveFrom: "2026-01-01",
              effectiveTo: null,
              sourceCitation: null,
              notes: null,
              alertDays: [],
            },
          ],
        } as Response;
      }),
    );

    render(<ComplianceRulesTab />);
    await waitFor(() => expect(screen.getByText("No expiry rules yet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Add Rule/i }));
    await waitFor(() => expect(screen.getByLabelText("Document Type")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Document Type"), { target: { value: "Food Handler" } });
    fireEvent.change(screen.getByLabelText("Effective From"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Food Handler")).toBeInTheDocument());
  });

  it("keeps the drawer open with an inline error when the save fails", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        initial: [],
        onPut: () => ({ ok: false, status: 400, body: { error: "A document type is required" } }),
      }),
    );
    render(<ComplianceRulesTab />);
    await waitFor(() => expect(screen.getByText("No expiry rules yet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Add Rule/i }));
    await waitFor(() => expect(screen.getByLabelText("Document Type")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Document Type"), { target: { value: "RSA" } });
    fireEvent.change(screen.getByLabelText("Effective From"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("A document type is required")).toBeInTheDocument());
    expect(screen.getByLabelText("Document Type")).toHaveValue("RSA");
  });
});

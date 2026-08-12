import { describe, it, expect } from "vitest";
import {
  generateComplianceReportPdf,
  type ComplianceReportPdfData,
  type ComplianceReportStaffRow,
} from "./compliancePdfService.js";

const PDF_MAGIC = "%PDF";

function buildStaffRow(i: number): ComplianceReportStaffRow {
  return {
    staffName: `Staff Member ${i}`,
    role: i % 7 === 0 ? "Head Chef" : "Kitchen Hand",
    engagementType: i % 5 === 0 ? "contractor" : i % 11 === 0 ? "agency" : "employee",
    documents: {
      RSA: i % 3 === 0 ? "Verified" : "Pending",
      "Food Handler": "Verified",
      "Police Check": i % 4 === 0 ? "Expired" : "Verified",
    },
  };
}

const BASE_DATA: ComplianceReportPdfData = {
  organisationName: "Almost French Pâtisserie",
  venueName: "CBD Kitchen",
  documentTypes: ["RSA", "Food Handler", "Police Check"],
  staff: [buildStaffRow(1), buildStaffRow(2), buildStaffRow(3)],
};

/** Individual page objects in the raw PDF stream — "/Type /Page", never the "/Type /Pages" tree root. */
function countPdfPages(buffer: Buffer): number {
  const matches = buffer.toString("latin1").match(/\/Type\s*\/Page(?!s)\b/g);
  return matches ? matches.length : 0;
}

describe("generateComplianceReportPdf", () => {
  it("returns a Buffer", async () => {
    const result = await generateComplianceReportPdf(BASE_DATA);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it("starts with the %PDF magic bytes", async () => {
    const result = await generateComplianceReportPdf(BASE_DATA);
    expect(result.subarray(0, 4).toString("latin1")).toBe(PDF_MAGIC);
  });

  it("paginates a large staff list instead of throwing", async () => {
    const staff = Array.from({ length: 300 }, (_, i) => buildStaffRow(i));
    const data: ComplianceReportPdfData = { ...BASE_DATA, staff };

    const result = await generateComplianceReportPdf(data);

    expect(result.subarray(0, 4).toString("latin1")).toBe(PDF_MAGIC);
    expect(countPdfPages(result)).toBeGreaterThan(1);
  });

  it("produces a valid PDF for an empty staff list rather than crashing", async () => {
    const data: ComplianceReportPdfData = { ...BASE_DATA, staff: [] };

    const result = await generateComplianceReportPdf(data);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.subarray(0, 4).toString("latin1")).toBe(PDF_MAGIC);
    expect(countPdfPages(result)).toBe(1);
  });

  it("produces a valid PDF when there are no required document types", async () => {
    const data: ComplianceReportPdfData = { ...BASE_DATA, documentTypes: [] };

    const result = await generateComplianceReportPdf(data);

    expect(result.subarray(0, 4).toString("latin1")).toBe(PDF_MAGIC);
  });
});

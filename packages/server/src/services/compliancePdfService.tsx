/**
 * @module services/compliancePdfService
 *
 * PDF generation for the audit-ready Compliance Vault export — the document
 * an inspector asks for on-site. One row per staff member, one column per
 * required document type, status shown as text inside a bordered box so the
 * report still means something after it's been photocopied in black and
 * white.
 *
 * Mirrors pdfService.tsx (generatePOPdf): @react-pdf/renderer, a
 * Promise.race timeout, Buffer out. The template lives in this file rather
 * than a separate templates/*.tsx module because this service owns nothing
 * else — see the file-ownership note in the task that created it.
 */

import { renderToBuffer } from "@react-pdf/renderer";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatAuDate } from "@culinaire/shared";
import pino from "pino";

const logger = pino({ name: "compliancePdfService" });

const PDF_TIMEOUT_MS = 10_000;

// ponytail: hard ceiling well above any real single-venue headcount (the task's
// own worst case is 400) — a backstop against a mis-scoped query rather than a
// limit any legitimate export should ever hit. Upgrade to a streamed/chunked
// export if a real org needs more staff in one report than this.
const MAX_STAFF_ROWS = 5000;

// ── Types ────────────────────────────────────────────────────────────

export type EngagementType = "employee" | "contractor" | "agency";

export interface ComplianceReportStaffRow {
  staffName: string;
  role: string;
  engagementType: EngagementType;
  /** documentType -> status label ("Verified", "Expired", "Pending", ...). Absent key renders "Missing". */
  documents: Record<string, string>;
}

export interface ComplianceReportPdfData {
  organisationName: string;
  /** The venue this snapshot covers, or null for an org-wide, all-venues export. */
  venueName: string | null;
  /** Column order — every row is looked up against this list. */
  documentTypes: string[];
  staff: ComplianceReportStaffRow[];
}

const ENGAGEMENT_LABELS: Record<EngagementType, string> = {
  employee: "Employee",
  contractor: "Contractor",
  agency: "Agency",
};

// ── Styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 56,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: "#D4A574",
    paddingBottom: 12,
  },
  orgName: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#1a1a1a",
  },
  venueName: {
    fontSize: 10,
    color: "#444444",
    marginTop: 3,
  },
  reportTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#D4A574",
  },
  generatedAt: {
    fontSize: 9,
    color: "#666666",
    marginTop: 4,
  },
  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f5f0eb",
    borderBottomWidth: 1,
    borderBottomColor: "#D4A574",
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5e5",
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  tableRowAlt: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e5e5",
    paddingVertical: 5,
    paddingHorizontal: 6,
    backgroundColor: "#fafafa",
  },
  headerText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: "#555555",
    textTransform: "uppercase" as const,
  },
  colName: { flex: 2.2, paddingRight: 4 },
  colRole: { flex: 1.3, paddingRight: 4 },
  colEngagement: { flex: 1.2, paddingRight: 4 },
  colDoc: { flex: 1.3, paddingRight: 4 },
  nameText: { fontSize: 8.5 },
  roleText: { fontSize: 8, color: "#444444" },
  // Bordered box every status/engagement renders in — text is the only thing
  // that survives a monochrome photocopy, so it never depends on colour.
  pill: {
    borderWidth: 0.75,
    borderColor: "#333333",
    borderRadius: 2,
    paddingVertical: 2,
    paddingHorizontal: 4,
    alignSelf: "flex-start" as const,
  },
  pillText: {
    fontSize: 7,
    color: "#1a1a1a",
  },
  pillTextEmphasis: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: "#1a1a1a",
  },
  emptyState: {
    marginTop: 20,
    fontSize: 10,
    color: "#666666",
  },
  truncationNote: {
    marginTop: 10,
    fontSize: 8,
    color: "#8a6d3b",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: "#e5e5e5",
    paddingTop: 8,
    fontSize: 8,
    color: "#999999",
  },
});

// ── Component ────────────────────────────────────────────────────────

/** "6 August 2026, 3:45 pm" — formatAuDate for the date per project convention, time appended manually since it has no time-aware variant. */
function formatGeneratedAt(d: Date): string {
  const time = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
  return `${formatAuDate(d)}, ${time}`;
}

function StatusPill({ text, emphasis = false }: { text: string; emphasis?: boolean }) {
  return (
    <View style={styles.pill}>
      <Text style={emphasis ? styles.pillTextEmphasis : styles.pillText}>{text}</Text>
    </View>
  );
}

function ComplianceReportPdf({ data }: { data: ComplianceReportPdfData }) {
  const generatedAt = new Date();
  const truncated = data.staff.length > MAX_STAFF_ROWS;
  const staff = truncated ? data.staff.slice(0, MAX_STAFF_ROWS) : data.staff;

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        {/* Repeats on every page — a page separated from the rest still self-identifies as a dated snapshot. */}
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.orgName}>{data.organisationName}</Text>
            {data.venueName && <Text style={styles.venueName}>{data.venueName}</Text>}
          </View>
          <View style={{ alignItems: "flex-end" as const }}>
            <Text style={styles.reportTitle}>Compliance Report</Text>
            <Text style={styles.generatedAt}>Generated {formatGeneratedAt(generatedAt)}</Text>
          </View>
        </View>

        {/* Table header repeats on every page react-pdf auto-generates for overflow. */}
        <View style={styles.tableHeader} fixed>
          <Text style={[styles.headerText, styles.colName]}>Staff</Text>
          <Text style={[styles.headerText, styles.colRole]}>Role</Text>
          <Text style={[styles.headerText, styles.colEngagement]}>Engagement</Text>
          {data.documentTypes.map((docType) => (
            <Text key={docType} style={[styles.headerText, styles.colDoc]}>
              {docType}
            </Text>
          ))}
        </View>

        {staff.length === 0 && (
          <Text style={styles.emptyState}>No staff records match this report.</Text>
        )}

        {/* wrap=false keeps a row atomic — it moves whole to the next page rather than splitting mid-row. */}
        {staff.map((row, i) => (
          <View key={i} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt} wrap={false}>
            <Text style={[styles.colName, styles.nameText]}>{row.staffName}</Text>
            <Text style={[styles.colRole, styles.roleText]}>{row.role}</Text>
            <View style={styles.colEngagement}>
              <StatusPill
                text={ENGAGEMENT_LABELS[row.engagementType]}
                emphasis={row.engagementType !== "employee"}
              />
            </View>
            {data.documentTypes.map((docType) => (
              <View key={docType} style={styles.colDoc}>
                <StatusPill text={row.documents[docType] ?? "Missing"} />
              </View>
            ))}
          </View>
        ))}

        {truncated && (
          <Text style={styles.truncationNote}>
            Showing the first {MAX_STAFF_ROWS} of {data.staff.length} staff records. Re-export
            scoped to a single venue for the complete list.
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text>CulinAIre Kitchen — Compliance Vault</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// ── Service ──────────────────────────────────────────────────────────

/**
 * Render the audit-ready compliance export to a PDF buffer. Data is assumed
 * already org-scoped and formatted by the caller — this function only lays
 * it out and renders it.
 */
export async function generateComplianceReportPdf(data: ComplianceReportPdfData): Promise<Buffer> {
  const pdfBuffer = await Promise.race([
    renderToBuffer(<ComplianceReportPdf data={data} />),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("PDF generation timed out")), PDF_TIMEOUT_MS),
    ),
  ]);

  logger.info(
    { staffCount: data.staff.length, documentTypeCount: data.documentTypes.length, sizeBytes: pdfBuffer.length },
    "Compliance report PDF generated",
  );

  return pdfBuffer as Buffer;
}

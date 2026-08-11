/**
 * @module components/compliance/StaffComplianceTable
 *
 * The staff roster with one compliance status per document type. Desktop
 * (>=768px) is a real table so the operator sees which certificate is the
 * problem without clicking in. Phone (<768px) is NOT a horizontal scroll —
 * the status columns are the entire point of the screen, so it collapses to
 * one card per person instead: name, role, worst status, failing document,
 * sorted worst-first.
 *
 * `getWorstStatus` / `isCompliant` are exported so ComplianceDashboard uses
 * the exact same severity rule for the headline count and the AnchorCard
 * list as this table uses for its own sort — one rule, one source of truth,
 * so the headline can never drift from what the table shows underneath it.
 *
 * Each row carries `id={staffRowId(userId)}` so AnchorCard's "Review" links
 * (`#staff-<id>`) jump straight to that person's row/card — a native anchor
 * scroll, no drill-down page exists (or is needed) for this.
 */

import { useMemo, useState } from "react";
import { Search, SearchX } from "lucide-react";
import { StatusPill, type StatusPillVariant } from "../ui/StatusPill.js";
import { EmptyState } from "../ui/EmptyState.js";

export interface StaffDocumentStatus {
  documentType: string;
  status: StatusPillVariant;
  /** ISO date string, or null when not applicable / never uploaded. */
  expiryDate: string | null;
}

export interface StaffComplianceRow {
  userId: number;
  name: string;
  role: string;
  /** One entry per document type this org tracks — "na" when never uploaded. */
  documents: StaffDocumentStatus[];
}

/** Worst-first ranking. expired/rejected/missing all mean "no valid document on file". */
const SEVERITY: Record<StatusPillVariant, number> = {
  expired: 4,
  rejected: 4,
  na: 4,
  expiring: 3,
  pending: 2,
  compliant: 1,
};

const STATUS_LABEL: Record<StatusPillVariant, string> = {
  compliant: "Compliant",
  expiring: "Expiring",
  expired: "Expired",
  pending: "Pending",
  rejected: "Rejected",
  na: "Missing",
};

/** DOM id for a staff row/card — shared with ComplianceDashboard's AnchorCard links. */
export function staffRowId(userId: number): string {
  return `staff-${userId}`;
}

/** The single most severe document status for a row, or null if they have none tracked. */
export function getWorstStatus(row: StaffComplianceRow): StaffDocumentStatus | null {
  if (row.documents.length === 0) return null;
  return row.documents.reduce((worst, doc) =>
    SEVERITY[doc.status] > SEVERITY[worst.status] ? doc : worst,
  );
}

/** Non-compliant = a document that's expired, rejected, or missing. Expiring/pending are warnings, not failures. */
export function isCompliant(row: StaffComplianceRow): boolean {
  const worst = getWorstStatus(row);
  return worst === null || SEVERITY[worst.status] < SEVERITY.expired;
}

function formatExpiry(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "RSA: Expired 15 Jun 2026" — full context for screen readers, not just the visible word. */
function pillAriaLabel(doc: StaffDocumentStatus): string {
  const expiry = formatExpiry(doc.expiryDate);
  return `${doc.documentType}: ${STATUS_LABEL[doc.status]}${expiry ? ` ${expiry}` : ""}`;
}

function sortWorstFirst(rows: StaffComplianceRow[]): StaffComplianceRow[] {
  return [...rows].sort((a, b) => {
    const sa = getWorstStatus(a);
    const sb = getWorstStatus(b);
    const diff = (sb ? SEVERITY[sb.status] : 0) - (sa ? SEVERITY[sa.status] : 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
}

export interface StaffComplianceTableProps {
  staff: StaffComplianceRow[];
}

export function StaffComplianceTable({ staff }: StaffComplianceTableProps) {
  const [query, setQuery] = useState("");

  const documentTypes = useMemo(() => {
    const seen: string[] = [];
    for (const row of staff) {
      for (const doc of row.documents) {
        if (!seen.includes(doc.documentType)) seen.push(doc.documentType);
      }
    }
    return seen;
  }, [staff]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? staff.filter((r) => r.name.toLowerCase().includes(q) || r.role.toLowerCase().includes(q))
      : staff;
    return sortWorstFirst(matched);
  }, [staff, query]);

  return (
    <div>
      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-dark-500"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search staff…"
          aria-label="Search staff"
          className="min-h-11 w-full rounded-xl border border-dark-200 bg-dark-50 py-2.5 pl-9 pr-3 text-sm text-[#E5E5E5] placeholder:text-dark-500"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No staff match that filter"
          body="Try a different name or role, or clear the search."
          action={{ label: "Clear filter", onClick: () => setQuery("") }}
          variant="no-match"
        />
      ) : (
        <>
          {/* Desktop (>=768px): one column per document type. */}
          <div className="hidden overflow-x-auto rounded-xl border border-dark-200 md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-dark-200 text-dark-600">
                  <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium">
                    Role
                  </th>
                  {documentTypes.map((type) => (
                    <th key={type} scope="col" className="whitespace-nowrap px-4 py-3 font-medium">
                      {type}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.userId} id={staffRowId(row.userId)} className="border-b border-dark-200 last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-[#FAFAFA]">{row.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-dark-600">{row.role}</td>
                    {documentTypes.map((type) => {
                      const doc = row.documents.find((d) => d.documentType === type);
                      return (
                        <td key={type} className="whitespace-nowrap px-4 py-3">
                          {doc ? (
                            <StatusPill variant={doc.status} ariaLabel={pillAriaLabel(doc)}>
                              {STATUS_LABEL[doc.status]}
                            </StatusPill>
                          ) : (
                            <span className="text-dark-500">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone (<768px): one card per person, worst status first. */}
          <ul className="space-y-2 md:hidden">
            {rows.map((row) => {
              const worst = getWorstStatus(row);
              return (
                <li
                  key={row.userId}
                  id={staffRowId(row.userId)}
                  className="rounded-xl border border-dark-200 bg-dark-100 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-[#FAFAFA]">{row.name}</p>
                      <p className="text-sm text-dark-600">{row.role}</p>
                    </div>
                    {worst && (
                      <StatusPill variant={worst.status} ariaLabel={pillAriaLabel(worst)}>
                        {STATUS_LABEL[worst.status]}
                      </StatusPill>
                    )}
                  </div>
                  {worst && <p className="mt-2 text-sm text-dark-600">{worst.documentType}</p>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

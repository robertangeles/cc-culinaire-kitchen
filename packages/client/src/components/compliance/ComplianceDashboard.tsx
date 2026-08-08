/**
 * @module components/compliance/ComplianceDashboard
 *
 * The operator dashboard: a calm, text-led headline, the AnchorCard, a flat
 * StatRow, then the full staff table. Top to bottom is the design — see the
 * module doc on StaffComplianceTable for why worst-status is computed there
 * and reused here.
 *
 * The headline count and the AnchorCard list are both derived from the same
 * `staff` array the table renders — never from a separately-aggregated
 * number — so "N of M staff are compliant" can never say something the
 * table underneath it doesn't back up.
 *
 * `GET /api/compliance/staff` is the one route this screen needs that does
 * not exist yet in `routes/compliance.ts` (see this component's PR notes) —
 * every other call here is a real, already-shipped endpoint.
 */

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Users } from "lucide-react";
import { AnchorCard, type AnchorCardItem } from "../ui/AnchorCard.js";
import { StatRow } from "../ui/StatRow.js";
import { EmptyState } from "../ui/EmptyState.js";
import {
  StaffComplianceTable,
  getWorstStatus,
  isCompliant,
  staffRowId,
  type StaffComplianceRow,
} from "./StaffComplianceTable.js";

/** Fields consumed from GET /api/compliance/dashboard (services/complianceService.ts). */
interface DashboardTotals {
  expiringWithin30Days: number;
  venueDocumentCount: number;
  contractorCount: number;
}

/** Fields consumed from GET /api/compliance/stats. */
interface StatsTotals {
  documentsByStatus: Record<string, number>;
}

interface LoadedState {
  status: "loading" | "error" | "ready";
  staff: StaffComplianceRow[];
  totals: DashboardTotals;
  pendingVerification: number;
}

const INITIAL_STATE: LoadedState = {
  status: "loading",
  staff: [],
  totals: { expiringWithin30Days: 0, venueDocumentCount: 0, contractorCount: 0 },
  pendingVerification: 0,
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Nearest upcoming expiry across every tracked document — the AnchorCard's all-clear subtext. */
function nextExpirySubtext(staff: StaffComplianceRow[]): string | undefined {
  const today = new Date();
  let soonest: Date | null = null;
  for (const row of staff) {
    for (const doc of row.documents) {
      if (!doc.expiryDate) continue;
      const date = new Date(doc.expiryDate);
      if (date < today) continue;
      if (!soonest || date < soonest) soonest = date;
    }
  }
  if (!soonest) return undefined;
  const days = Math.round((soonest.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  return `Next expiry in ${days} ${days === 1 ? "day" : "days"}`;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8" aria-hidden="true">
      <div className="space-y-3">
        <div className="h-8 w-80 max-w-full rounded bg-dark-100 animate-pulse motion-reduce:animate-none" />
        <div className="h-px w-16 bg-dark-200" />
      </div>
      <div className="h-32 rounded-xl border border-dark-200 bg-dark-100 animate-pulse motion-reduce:animate-none" />
      <div className="flex flex-wrap gap-8">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-5 w-28 rounded bg-dark-100 animate-pulse motion-reduce:animate-none" />
        ))}
      </div>
      <div className="h-64 rounded-xl border border-dark-200 bg-dark-100 animate-pulse motion-reduce:animate-none" />
    </div>
  );
}

export function ComplianceDashboard() {
  const [state, setState] = useState<LoadedState>(INITIAL_STATE);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: "loading" }));
    try {
      const [dashboard, stats, staff] = await Promise.all([
        fetchJson<DashboardTotals>("/api/compliance/dashboard"),
        fetchJson<StatsTotals>("/api/compliance/stats"),
        fetchJson<StaffComplianceRow[]>("/api/compliance/staff"),
      ]);
      setState({
        status: "ready",
        staff,
        totals: {
          expiringWithin30Days: dashboard.expiringWithin30Days,
          venueDocumentCount: dashboard.venueDocumentCount,
          contractorCount: dashboard.contractorCount,
        },
        pendingVerification: stats.documentsByStatus.Pending ?? 0,
      });
    } catch {
      setState((s) => ({ ...s, status: "error" }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") return <DashboardSkeleton />;

  if (state.status === "error") {
    return (
      <div role="alert" className="rounded-xl border border-dark-200 bg-dark-100 px-4 py-10 text-center">
        <p className="text-sm text-[#E5E5E5]">We couldn&apos;t load the compliance dashboard. Please try again.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  if (state.staff.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No one on the team yet"
        body="Add staff to start tracking their compliance documents."
        action={{ label: "Add a staff member", href: "/settings" }}
        variant="invitation"
      />
    );
  }

  const nonCompliant = state.staff.filter((row) => !isCompliant(row));
  const compliantCount = state.staff.length - nonCompliant.length;

  const anchorItems: AnchorCardItem[] = nonCompliant
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => {
      const worst = getWorstStatus(row);
      return {
        id: String(row.userId),
        label: worst ? `${row.name} — ${worst.documentType} ${worst.status === "na" ? "missing" : worst.status}` : row.name,
        actionLabel: "Review",
        href: `#${staffRowId(row.userId)}`,
      };
    });

  return (
    <div className="space-y-8">
      <div>
        {/* h2, not h1 — CompliancePage's "Compliance" title is the page's h1. */}
        <h2 className="text-2xl font-semibold text-[#FAFAFA] sm:text-3xl">
          {compliantCount} of {state.staff.length} staff are compliant
        </h2>
        <div className="mt-3 h-px w-16 bg-gold" />
      </div>

      <AnchorCard items={anchorItems} allClearSubtext={nextExpirySubtext(state.staff)} />

      <StatRow
        entries={[
          // The first two labels are adjectival and read correctly at any
          // count; the last two are nouns, so they pluralise.
          { label: "expiring soon", value: state.totals.expiringWithin30Days },
          { label: "pending verification", value: state.pendingVerification },
          {
            label: state.totals.venueDocumentCount === 1 ? "venue document" : "venue documents",
            value: state.totals.venueDocumentCount,
          },
          {
            label: state.totals.contractorCount === 1 ? "contractor" : "contractors",
            value: state.totals.contractorCount,
          },
        ]}
      />

      <StaffComplianceTable staff={state.staff} />
    </div>
  );
}

/**
 * @module pages/RosterPage
 *
 * Page shell for Roster Core, mounted at `/roster` (see navConfig.ts).
 * Same pattern as CompliancePage: tabs are picked from what the user
 * actually holds, and a component for a permission the user lacks is
 * never mounted (so it never fetches and never 403s).
 */

import { useMemo, useState } from "react";
import { CalendarClock, CalendarDays, Gauge, Grid3x3, ListChecks, UserCog, Users } from "lucide-react";
import { useAuth } from "../context/AuthContext.js";
import { useHasPermission } from "../hooks/useHasPermission.js";
import { ShiftsManager } from "../components/roster/ShiftsManager.js";
import { RolesManager } from "../components/roster/RolesManager.js";
import { MyShiftsView } from "../components/roster/MyShiftsView.js";
import { MyAvailabilityManager } from "../components/roster/MyAvailabilityManager.js";
import { WorkforceDemandView } from "../components/roster/WorkforceDemandView.js";
import { StaffingCoverageView } from "../components/roster/StaffingCoverageView.js";

type RosterTab = "shifts" | "roles" | "mine" | "availability" | "demand" | "coverage";

export function RosterPage() {
  const { user, isGuest } = useAuth();
  const hasPermission = useHasPermission();
  const canReadAll = hasPermission("roster:read-all");
  const canReadOwn = hasPermission("roster:read-own");

  const tabs = useMemo(() => {
    const t: { key: RosterTab; label: string; icon: typeof Users }[] = [];
    if (canReadAll) t.push({ key: "shifts", label: "Shifts", icon: CalendarDays });
    if (canReadAll) t.push({ key: "roles", label: "Roles", icon: ListChecks });
    if (canReadOwn) t.push({ key: "mine", label: "My Shifts", icon: UserCog });
    if (canReadOwn) t.push({ key: "availability", label: "My Availability", icon: CalendarClock });
    if (canReadAll) t.push({ key: "demand", label: "Demand", icon: Gauge });
    if (canReadAll) t.push({ key: "coverage", label: "Coverage", icon: Grid3x3 });
    return t;
  }, [canReadAll, canReadOwn]);

  const [selectedTab, setSelectedTab] = useState<RosterTab | null>(null);
  const activeTab = tabs.find((t) => t.key === selectedTab)?.key ?? tabs[0]?.key ?? null;

  if (isGuest || !user) {
    return (
      <div className="flex flex-1 items-center justify-center bg-dark">
        <div className="max-w-md px-6 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-dark-100">
            <CalendarDays className="size-8 text-gold" aria-hidden="true" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-[#FAFAFA]">Roster</h2>
          <p className="text-sm text-dark-600">Sign in to view the roster.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-dark">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-r from-gold to-gold-hover shadow-[0_0_12px_rgba(212,165,116,0.2)]">
            <CalendarDays className="size-5 text-dark" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-[#FAFAFA]">Roster</h1>
        </header>

        {tabs.length > 1 && (
          <div
            className="mb-6 flex flex-wrap gap-1 rounded-xl border border-dark-200 bg-dark-100 p-1"
            role="tablist"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setSelectedTab(tab.key)}
                  className={`flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-all duration-200 ${
                    isActive ? "bg-dark-200 text-[#FAFAFA]" : "text-dark-600 hover:text-[#FAFAFA]"
                  }`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}

        {activeTab === "shifts" && <ShiftsManager />}
        {activeTab === "roles" && <RolesManager />}
        {activeTab === "mine" && <MyShiftsView />}
        {activeTab === "availability" && <MyAvailabilityManager />}
        {activeTab === "demand" && <WorkforceDemandView />}
        {activeTab === "coverage" && <StaffingCoverageView />}
        {activeTab === null && (
          <p className="text-sm text-dark-600">
            Nothing to show here yet. Ask an admin to check your roster permissions.
          </p>
        )}
      </div>
    </div>
  );
}

export default RosterPage;

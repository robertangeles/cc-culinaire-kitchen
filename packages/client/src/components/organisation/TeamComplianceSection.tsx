/**
 * @module components/organisation/TeamComplianceSection
 *
 * Team Compliance content, relocated from the standalone /compliance route
 * (formerly pages/CompliancePage.tsx, under Run the Kitchen) into the
 * Organisation page as a tab. Compliance data is org-wide, never
 * location-filtered (verified: neither ComplianceDashboard nor
 * VerificationView reference store-location context), so it never needed
 * the Kitchen Ops location-switcher chrome it was incidentally wrapped in.
 *
 * The isGuest/no-user empty state from the old page is dropped — this now
 * mounts under /organisation, already behind AuthenticatedOnly, so that
 * branch is unreachable. The "auth resolves after first render" defense
 * stays: user starts null while AuthContext is still fetching, so tabs must
 * be recomputed each render, never seeded once via useState.
 */

import { useMemo, useState } from "react";
import { Users, ClipboardCheck } from "lucide-react";
import { useHasPermission } from "../../hooks/useHasPermission.js";
import { ComplianceDashboard } from "../compliance/ComplianceDashboard.js";
import { VerificationView } from "../compliance/VerificationView.js";
import { PillTabs } from "../ui/PillTabs.js";

type ComplianceTab = "team" | "verify";

export function TeamComplianceSection() {
  const hasPermission = useHasPermission();
  const canReadAll = hasPermission("compliance:read-all");
  const canVerify = hasPermission("compliance:verify");

  const tabs = useMemo(() => {
    const t: { key: ComplianceTab; label: string; icon: typeof Users }[] = [];
    if (canReadAll) t.push({ key: "team", label: "Team", icon: Users });
    if (canVerify) t.push({ key: "verify", label: "Verify", icon: ClipboardCheck });
    return t;
  }, [canReadAll, canVerify]);

  const [selectedTab, setSelectedTab] = useState<ComplianceTab | null>(null);
  const activeTab = tabs.find((t) => t.key === selectedTab)?.key ?? tabs[0]?.key ?? null;

  return (
    <div>
      {tabs.length > 1 && (
        <PillTabs
          tabs={tabs.map(({ key, label, icon }) => ({ id: key, label, icon }))}
          active={activeTab}
          onChange={setSelectedTab}
          className="mb-6 flex flex-wrap gap-1 rounded-xl border border-dark-200 bg-dark-100 p-1"
          tabClassName="gap-2 rounded-lg px-4 text-sm font-medium transition-all duration-200"
          activeClassName="bg-dark-200 text-[#FAFAFA]"
          inactiveClassName="text-dark-600 hover:text-[#FAFAFA]"
        />
      )}

      {activeTab === "team" && <ComplianceDashboard />}
      {activeTab === "verify" && <VerificationView />}
      {activeTab === null && (
        <p className="text-sm text-dark-600">
          Nothing to show here yet. Ask an admin to check your compliance permissions.
        </p>
      )}
    </div>
  );
}

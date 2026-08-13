/**
 * @module pages/CompliancePage
 *
 * Page shell for Team Compliance, mounted at `/compliance` (see
 * navConfig.ts). Team and Verify are the only tabs here — both are
 * manager-facing. My Documents moved to the user's Profile and Requirements
 * moved to Admin Settings, each mounted where its audience actually looks
 * for it.
 */

import { useMemo, useState } from "react";
import { ShieldCheck, Users, ClipboardCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext.js";
import { useHasPermission } from "../hooks/useHasPermission.js";
import { ComplianceDashboard } from "../components/compliance/ComplianceDashboard.js";
import { VerificationView } from "../components/compliance/VerificationView.js";

type ComplianceTab = "team" | "verify";

export function CompliancePage() {
  const { user, isGuest } = useAuth();
  const hasPermission = useHasPermission();
  const canReadAll = hasPermission("compliance:read-all");
  const canVerify = hasPermission("compliance:verify");

  // Team is listed (and default) ahead of Verify: this page used to render
  // only ComplianceDashboard, so anyone who already had compliance:read-all
  // keeps landing on the same view as before.
  const tabs = useMemo(() => {
    const t: { key: ComplianceTab; label: string; icon: typeof Users }[] = [];
    if (canReadAll) t.push({ key: "team", label: "Team", icon: Users });
    if (canVerify) t.push({ key: "verify", label: "Verify", icon: ClipboardCheck });
    return t;
  }, [canReadAll, canVerify]);
  // Holds an explicit user choice only; null means "hasn't picked one yet".
  //
  // Deliberately NOT seeded with useState(tabs[0]?.key). AuthContext starts
  // with user === null and fills it in asynchronously, so on the very first
  // render `tabs` is empty for everyone — a useState seed would capture null
  // and never re-evaluate, leaving every user, Administrators included,
  // permanently on the "nothing to show" fallback.
  const [selectedTab, setSelectedTab] = useState<ComplianceTab | null>(null);

  // Resolved per render, and re-checked against the tabs the user currently
  // has, so a selection that is no longer permitted falls back instead of
  // rendering a blank page.
  const activeTab =
    tabs.find((t) => t.key === selectedTab)?.key ?? tabs[0]?.key ?? null;

  if (isGuest || !user) {
    return (
      <div className="flex flex-1 items-center justify-center bg-dark">
        <div className="max-w-md px-6 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-dark-100">
            <ShieldCheck className="size-8 text-gold" aria-hidden="true" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-[#FAFAFA]">Team Compliance</h2>
          <p className="text-sm text-dark-600">Sign in to view staff compliance status.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-dark">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-r from-gold to-gold-hover shadow-[0_0_12px_rgba(212,165,116,0.2)]">
            <ShieldCheck className="size-5 text-dark" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-[#FAFAFA]">Team Compliance</h1>
        </header>

        {/* A single-tab user (e.g. a manager holding read-all but not verify)
            never sees this bar — a tablist with one option is chrome, not a
            choice. flex-wrap is free insurance against horizontal scroll on
            narrow screens; two short labels never actually need it. */}
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

        {/* Each branch mounts exactly one component, and only the one whose
            endpoint the active tab's permission covers — a component for a
            permission the user lacks is never rendered, so it never fetches
            and never 403s. */}
        {activeTab === "team" && <ComplianceDashboard />}
        {activeTab === "verify" && <VerificationView />}
        {activeTab === null && (
          <p className="text-sm text-dark-600">
            Nothing to show here yet. Ask an admin to check your compliance permissions.
          </p>
        )}
      </div>
    </div>
  );
}

export default CompliancePage;

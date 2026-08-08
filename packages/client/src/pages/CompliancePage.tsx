/**
 * @module pages/CompliancePage
 *
 * Page shell for Compliance, mounted at `/compliance` (see navConfig.ts).
 * The route itself allows any of compliance:read-own / read-all / verify /
 * manage-rules, but each of those unlocks a different screen with different
 * endpoints behind it — so this page picks tabs from what the user actually
 * holds, rather than always rendering the manager dashboard. A user with
 * only read-own must never mount (and never fetch from) the read-all or
 * verify views.
 */

import { useMemo, useState } from "react";
import { ShieldCheck, Users, ClipboardCheck, FileText, ListChecks } from "lucide-react";
import { useAuth } from "../context/AuthContext.js";
import { useHasPermission } from "../hooks/useHasPermission.js";
import { ComplianceDashboard } from "../components/compliance/ComplianceDashboard.js";
import { VerificationView } from "../components/compliance/VerificationView.js";
import { MyDocumentsTab } from "../components/compliance/MyDocumentsTab.js";
import { RequiredDocumentsTab } from "../components/compliance/RequiredDocumentsTab.js";

type ComplianceTab = "team" | "verify" | "mine" | "requirements";

export function CompliancePage() {
  const { user, isGuest } = useAuth();
  const hasPermission = useHasPermission();
  const canReadOwn = hasPermission("compliance:read-own");
  const canReadAll = hasPermission("compliance:read-all");
  const canVerify = hasPermission("compliance:verify");
  const canManageRules = hasPermission("compliance:manage-rules");

  // Team and Verify are listed (and default) ahead of My Documents: this page
  // used to render only ComplianceDashboard, so anyone who already had
  // compliance:read-all keeps landing on the same view as before. My
  // Documents only becomes the default for someone who holds read-own alone.
  // Requirements is listed last, for the same reason: it must never displace
  // Team as the default for anyone who already lands there today.
  const tabs = useMemo(() => {
    const t: { key: ComplianceTab; label: string; icon: typeof Users }[] = [];
    if (canReadAll) t.push({ key: "team", label: "Team", icon: Users });
    if (canVerify) t.push({ key: "verify", label: "Verify", icon: ClipboardCheck });
    if (canReadOwn) t.push({ key: "mine", label: "My Documents", icon: FileText });
    if (canManageRules) t.push({ key: "requirements", label: "Requirements", icon: ListChecks });
    return t;
  }, [canReadAll, canVerify, canReadOwn, canManageRules]);
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
          <h2 className="mb-2 text-xl font-semibold text-[#FAFAFA]">Compliance</h2>
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
          <h1 className="text-2xl font-bold text-[#FAFAFA]">Compliance</h1>
        </header>

        {/* A single-tab user (e.g. a line cook with only compliance:read-own)
            never sees this bar — a tablist with one option is chrome, not a
            choice. flex-wrap is free insurance against horizontal scroll on
            narrow screens; three short labels never actually need it. */}
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
        {activeTab === "mine" && <MyDocumentsTab />}
        {activeTab === "requirements" && <RequiredDocumentsTab />}
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

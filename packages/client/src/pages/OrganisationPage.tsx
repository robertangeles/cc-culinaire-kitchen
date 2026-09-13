/**
 * @module pages/OrganisationPage
 *
 * Org-scoped administration: User Management (relocated from Profile →
 * Team), Organisation Settings (branding + operational defaults), and Team
 * Compliance (relocated from the standalone /compliance route). Reachable
 * from the Profile menu → Organisation.
 *
 * User Management and Organisation Settings require org:manage-organisation
 * (Operations Admin). Team Compliance requires compliance:read-all or
 * compliance:verify instead — a Paid Subscriber holds those without holding
 * org:manage-organisation, so tabs are filtered per-user, same as
 * SettingsLayout's permission-gated tab registry.
 */

import { useEffect, useState, type KeyboardEvent } from "react";
import { Loader2, AlertCircle, Users, Settings2, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext.js";
import { useHasPermission } from "../hooks/useHasPermission.js";
import { TeamMembersSection } from "../components/organisation/TeamMembersSection.js";
import { OrganisationBrandingForm, type OrganisationSettings } from "../components/organisation/OrganisationBrandingForm.js";
import { TeamComplianceSection } from "../components/organisation/TeamComplianceSection.js";

type OrgTab = "team" | "settings" | "compliance";

const ALL_TABS: Array<{ id: OrgTab; label: string; icon: typeof Users; description: string; permissions: string[] }> = [
  { id: "team", label: "User Management", icon: Users, description: "Manage who belongs to your organisation and their access level.", permissions: ["org:manage-organisation"] },
  { id: "settings", label: "Organisation Settings", icon: Settings2, description: "Branding and operational defaults for your organisation.", permissions: ["org:manage-organisation"] },
  { id: "compliance", label: "Team Compliance", icon: ShieldCheck, description: "Staff certificates, expiry status, and verification.", permissions: ["compliance:read-all", "compliance:verify"] },
];

/**
 * Sidebar + header/body shell deliberately mirrors SettingsLayout /
 * SiteSettingsTab's markup and tokens (w-56 border-r sidebar, same tab
 * button states, same header/body split) so org-scoped administration reads
 * as the same app section as platform Admin Settings, not a bespoke pattern.
 * Not sharing SettingsLayout itself — its tabs are a hardcoded, permission-
 * gated registry for platform-wide settings, not built to accept an external
 * tab set — so this is a small local mirror rather than a shared component
 * for what is still a single consumer.
 */
export default function OrganisationPage() {
  const { user } = useAuth();
  const hasPermission = useHasPermission();
  const [org, setOrg] = useState<OrganisationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Holds an explicit user choice only; null means "hasn't picked one yet"
  // or "auth hasn't resolved yet". NOT seeded via useState(visibleTabs[0]) —
  // AuthContext starts with user === null and fills it in asynchronously, so
  // on the first render visibleTabs is empty for everyone (mirrors
  // CompliancePage's identical defense, now needed here too since tabs are
  // permission-filtered).
  const [selectedTab, setSelectedTab] = useState<OrgTab | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/organisations/mine", { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load organisation");
        const data = await res.json();
        if (!data.organisation) throw new Error("You are not a member of any organisation");
        setOrg(data.organisation);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load organisation");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visibleTabs = ALL_TABS.filter((t) => hasPermission(...t.permissions));
  const tab = visibleTabs.find((t) => t.id === selectedTab)?.id ?? visibleTabs[0]?.id ?? null;

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const currentIndex = visibleTabs.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowDown" ? (currentIndex + 1) % visibleTabs.length : (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
    setSelectedTab(visibleTabs[next].id);
    document.getElementById(`organisation-tab-${visibleTabs[next].id}`)?.focus();
  }

  const activeTab = visibleTabs.find((t) => t.id === tab);

  return (
    <div className="flex h-full bg-dark">
      {/* Tab navigation */}
      <div className="w-56 border-r border-dark-200 bg-dark px-3 py-6">
        <h2 className="px-3 mb-1 text-sm font-semibold text-dark-500 uppercase tracking-wider">
          Organisation
        </h2>
        {org && <p className="px-3 mb-4 text-xs text-dark-600 truncate">{org.organisationName}</p>}
        <nav role="tablist" aria-label="Organisation" aria-orientation="vertical" className="space-y-1">
          {visibleTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`organisation-tabpanel-${id}`}
              id={`organisation-tab-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setSelectedTab(id)}
              onKeyDown={handleTabKeyDown}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                tab === id
                  ? "bg-dark-100 text-[#FAFAFA] shadow-sm"
                  : "text-dark-600 hover:bg-dark-100/60 hover:text-[#FAFAFA]"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content area */}
      <div
        role="tabpanel"
        id={`organisation-tabpanel-${tab}`}
        aria-labelledby={`organisation-tab-${tab}`}
        className="flex-1 overflow-y-auto bg-dark"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 animate-spin text-dark-500" />
          </div>
        ) : error || !org ? (
          <div className="px-8 py-6">
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertCircle className="size-4 flex-shrink-0" /> {error || "No organisation found."}
            </div>
          </div>
        ) : !activeTab ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 animate-spin text-dark-500" />
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="px-8 py-6 border-b border-dark-200">
              <h1 className="text-xl font-semibold text-[#FAFAFA]">{activeTab.label}</h1>
              <p className="mt-1 text-sm text-dark-600">{activeTab.description}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-8 py-6">
              {tab === "team" && user && (
                <TeamMembersSection orgId={org.organisationId} currentUserId={user.userId} />
              )}
              {tab === "settings" && (
                <OrganisationBrandingForm org={org} onUpdated={setOrg} />
              )}
              {tab === "compliance" && <TeamComplianceSection />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

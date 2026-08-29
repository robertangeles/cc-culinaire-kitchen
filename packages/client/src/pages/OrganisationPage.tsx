/**
 * @module pages/OrganisationPage
 *
 * Org-scoped administration: User Management (relocated from Profile →
 * Team) and Organisation Settings (branding + operational defaults).
 * Reachable from the Profile menu → Organisation. Gated on
 * org:manage-organisation — held by Operations Admin (the org creator's
 * default role) or anyone else explicitly granted it.
 */

import { useEffect, useState } from "react";
import { Loader2, AlertCircle, Users, Settings2 } from "lucide-react";
import { useAuth } from "../context/AuthContext.js";
import { TeamMembersSection } from "../components/organisation/TeamMembersSection.js";
import { OrganisationBrandingForm, type OrganisationSettings } from "../components/organisation/OrganisationBrandingForm.js";

type OrgTab = "team" | "settings";

export default function OrganisationPage() {
  const { user } = useAuth();
  const [org, setOrg] = useState<OrganisationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<OrgTab>("team");

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

  const tabs: Array<{ id: OrgTab; label: string; Icon: typeof Users }> = [
    { id: "team", label: "User Management", Icon: Users },
    { id: "settings", label: "Organisation Settings", Icon: Settings2 },
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-[#FAFAFA] mb-1">Organisation</h1>
      <p className="text-sm text-dark-500 mb-6">{org?.organisationName}</p>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-dark-500" />
        </div>
      ) : error || !org ? (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="size-4 flex-shrink-0" /> {error || "No organisation found."}
        </div>
      ) : (
        <div>
          <div className="flex gap-1 mb-6">
            {tabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  tab === id ? "bg-gold text-dark font-medium" : "bg-dark-100 text-dark-600 hover:bg-dark-200"
                }`}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          {tab === "team" && user && (
            <TeamMembersSection orgId={org.organisationId} currentUserId={user.userId} />
          )}

          {tab === "settings" && (
            <OrganisationBrandingForm org={org} onUpdated={setOrg} />
          )}
        </div>
      )}
    </div>
  );
}

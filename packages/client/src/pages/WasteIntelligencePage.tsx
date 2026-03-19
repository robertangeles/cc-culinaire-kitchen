/**
 * @module pages/WasteIntelligencePage
 *
 * Waste Intelligence Lite — track kitchen waste, view analytics,
 * and get AI-powered reuse suggestions.
 *
 * Three tabs: Log Waste | Dashboard | Reuse Ideas
 * Guest users see a sign-up prompt instead of content.
 */

import { useState, useEffect } from "react";
import { Leaf, LogIn, Shield } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "../context/AuthContext.js";
import { WasteLogger } from "../components/waste/WasteLogger.js";
import { WasteDashboard } from "../components/waste/WasteDashboard.js";
import { WasteReuseSuggestions } from "../components/waste/WasteReuseSuggestions.js";

export type WasteTab = "log" | "dashboard" | "reuse";

export interface OrgContext {
  hasOrg: boolean;
  orgName: string | null;
  isOrgAdmin: boolean;
  memberCount: number;
}

const TABS: { key: WasteTab; label: string }[] = [
  { key: "log", label: "Log Waste" },
  { key: "dashboard", label: "Dashboard" },
  { key: "reuse", label: "Reuse Ideas" },
];

export function WasteIntelligencePage() {
  const { user, isGuest } = useAuth();
  const [activeTab, setActiveTab] = useState<WasteTab>("log");
  const [orgContext, setOrgContext] = useState<OrgContext | null>(null);
  const [teamView, setTeamView] = useState(false);

  // Fetch org context on mount
  useEffect(() => {
    if (isGuest || !user) return;

    (async () => {
      try {
        const res = await fetch("/api/waste/org-context", { credentials: "include" });
        if (res.ok) {
          const data: OrgContext = await res.json();
          setOrgContext(data);
          // Default to team view if user has an org
          if (data.hasOrg) setTeamView(true);
        }
      } catch {
        // silent — personal view is the fallback
      }
    })();
  }, [user, isGuest]);

  // Guest users see sign-up prompt
  if (isGuest || !user) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-900">
        <div className="min-h-full flex flex-col items-center justify-center p-6 md:p-10">
          <Leaf className="size-12 mx-auto mb-4 text-amber-500" />
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">Waste Intelligence</h1>
          <p className="text-gray-400 mb-6 text-center max-w-md">
            Sign up to track kitchen waste, uncover cost savings, and get AI-powered reuse suggestions.
          </p>
          <Link
            to="/register"
            className="inline-flex items-center gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg transition-colors"
          >
            <LogIn className="size-4" />
            Sign Up to Track Kitchen Waste
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <Leaf className="size-10 mx-auto mb-3 text-amber-500" />
          <h1 className="text-2xl md:text-3xl font-bold text-white">Waste Intelligence</h1>
          <p className="text-gray-400 mt-2">
            {orgContext?.hasOrg && orgContext.orgName
              ? `${orgContext.orgName} Kitchen`
              : "Track waste. Cut costs. Reuse smarter."}
          </p>
        </div>

        {/* Data scope toggle — only visible if user has an org */}
        {orgContext?.hasOrg && (
          <div className="flex items-center justify-center gap-2 mb-6">
            <button
              onClick={() => setTeamView(false)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                !teamView
                  ? "bg-amber-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              My Data
            </button>
            <button
              onClick={() => setTeamView(true)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                teamView
                  ? "bg-amber-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              Team Data{orgContext.memberCount > 0 ? ` (${orgContext.memberCount})` : ""}
            </button>
            {orgContext.isOrgAdmin && (
              <span className="ml-1 inline-flex items-center gap-1 px-2 py-1 bg-amber-900/40 border border-amber-700/40 rounded text-xs text-amber-400 font-medium">
                <Shield className="size-3" />
                Admin
              </span>
            )}
          </div>
        )}

        {/* Tab navigation */}
        <div className="flex justify-center gap-2 mb-8">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-2.5 rounded-full text-sm font-medium transition-colors min-h-[44px] ${
                activeTab === tab.key
                  ? "bg-amber-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "log" && (
          <WasteLogger
            onSwitchTab={setActiveTab}
            teamView={teamView}
            isOrgAdmin={orgContext?.isOrgAdmin ?? false}
          />
        )}
        {activeTab === "dashboard" && (
          <WasteDashboard
            onSwitchTab={setActiveTab}
            teamView={teamView}
          />
        )}
        {activeTab === "reuse" && <WasteReuseSuggestions />}
      </div>
    </div>
  );
}

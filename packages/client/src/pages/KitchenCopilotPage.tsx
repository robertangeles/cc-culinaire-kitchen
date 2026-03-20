/**
 * @module pages/KitchenCopilotPage
 *
 * Kitchen Operations Copilot Lite — menu-driven daily prep planning,
 * cross-usage analysis, high-impact dish insights, and session history.
 *
 * Four tabs: Today's Prep | Cross-Usage | High-Impact | History
 *
 * Today's Prep uses a state machine:
 *   loading  -> fetching today's session
 *   no-session -> welcome + "Plan Today's Prep" button
 *   selecting -> PrepMenuSelector (dish selection)
 *   prepping  -> PrepDashboard (task list)
 *
 * Guest users see a sign-up prompt instead of content.
 */

import { useState, useEffect, useCallback } from "react";
import { ClipboardList, LogIn, Loader2, Shield, ChefHat } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "../context/AuthContext.js";
import { PrepDashboard } from "../components/copilot/PrepDashboard.js";
import { PrepMenuSelector } from "../components/copilot/PrepMenuSelector.js";
import { CrossUsageView } from "../components/copilot/CrossUsageView.js";
import { HighImpactView } from "../components/copilot/HighImpactView.js";
import { PrepHistory } from "../components/copilot/PrepHistory.js";

interface OrgContext {
  hasOrg: boolean;
  orgName: string | null;
  isOrgAdmin: boolean;
  memberCount: number;
}

type CopilotTab = "prep" | "cross-usage" | "high-impact" | "history";
type CopilotState = "loading" | "no-session" | "selecting" | "prepping";

const TABS: { key: CopilotTab; label: string }[] = [
  { key: "prep", label: "Today's Prep" },
  { key: "cross-usage", label: "Cross-Usage" },
  { key: "high-impact", label: "High-Impact" },
  { key: "history", label: "History" },
];

interface PrepTask {
  prepTaskId: string;
  prepSessionId: string;
  menuItemId: string | null;
  recipeId: string | null;
  taskDescription: string;
  ingredientName: string;
  quantityNeeded: number;
  unit: string;
  prepTimeMinutes: number | null;
  priorityScore: number;
  priorityTier: string;
  station: string | null;
  status: string;
  assignedTo: string | null;
  completedAt: string | null;
  createdDttm: string;
}

interface PrepSession {
  prepSessionId: string;
  userId: number;
  prepDate: string;
  expectedCovers: number | null;
  actualCovers: number | null;
  tasksTotal: number;
  tasksCompleted: number;
  tasksSkipped: number;
  notes: string | null;
  createdDttm: string;
  updatedDttm: string;
}

interface PrepSessionWithTasks {
  session: PrepSession;
  tasks: PrepTask[];
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getTodayDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function KitchenCopilotPage() {
  const { user, isGuest } = useAuth();
  const [activeTab, setActiveTab] = useState<CopilotTab>("prep");
  const [copilotState, setCopilotState] = useState<CopilotState>("loading");
  const [sessionData, setSessionData] = useState<PrepSessionWithTasks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [orgContext, setOrgContext] = useState<OrgContext | null>(null);
  const [teamView, setTeamView] = useState(false);

  /** Load today's existing prep session on mount. */
  const loadTodaySession = useCallback(async () => {
    setCopilotState("loading");
    setError(null);
    try {
      const params = teamView ? "?teamView=true" : "";
      const res = await fetch(`/api/prep/sessions/today${params}`, { credentials: "include" });

      if (res.status === 404) {
        // No session for today
        setSessionData(null);
        setCopilotState("no-session");
        return;
      }

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
      }

      const data = await res.json();

      // Backend may return null or empty object when no session exists
      if (!data || !data.session) {
        setSessionData(null);
        setCopilotState("no-session");
        return;
      }

      setSessionData(data as PrepSessionWithTasks);

      // Decide state: if session has tasks -> prepping, else -> selecting
      if (data.tasks && data.tasks.length > 0) {
        setCopilotState("prepping");
      } else {
        setCopilotState("selecting");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session");
      setCopilotState("no-session");
    }
  }, [teamView]);

  // Fetch org context on mount
  useEffect(() => {
    if (isGuest || !user) return;

    (async () => {
      try {
        const res = await fetch("/api/waste/org-context", { credentials: "include" });
        if (res.ok) {
          const data: OrgContext = await res.json();
          setOrgContext(data);
          if (data.hasOrg) setTeamView(true);
        }
      } catch {
        // silent — personal view is the fallback
      }
    })();
  }, [user, isGuest]);

  useEffect(() => {
    if (!isGuest && user) {
      loadTodaySession();
    } else {
      setCopilotState("no-session");
    }
  }, [isGuest, user, loadTodaySession]);

  /** Create a new empty prep session for today. */
  const createSession = async () => {
    setCreatingSession(true);
    setError(null);
    try {
      const res = await fetch("/api/prep/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          prepDate: new Date().toISOString().split("T")[0],
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
      }
      const data: PrepSessionWithTasks = await res.json();
      setSessionData(data);
      setCopilotState("selecting");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setCreatingSession(false);
    }
  };

  /** Called when PrepMenuSelector finishes generating tasks. */
  const handleGenerated = (data: PrepSessionWithTasks) => {
    setSessionData(data);
    setCopilotState("prepping");
  };

  // Guest users see sign-up prompt
  if (isGuest || !user) {
    return (
      <div className="flex-1 overflow-y-auto bg-[#0A0A0A]">
        <div className="min-h-full flex flex-col items-center justify-center p-6 md:p-10">
          <ClipboardList className="size-12 mx-auto mb-4 text-[#D4A574]" />
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">Kitchen Copilot</h1>
          <p className="text-[#999999] mb-6 text-center max-w-md">
            Sign up to plan your kitchen prep, track cross-usage, and identify high-impact dishes.
          </p>
          <Link
            to="/register"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#D4A574] hover:bg-[#C4956A] text-white font-medium rounded-lg transition-colors"
          >
            <LogIn className="size-4" />
            Sign Up to Plan Your Kitchen Prep
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#0A0A0A]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <ClipboardList className="size-10 mx-auto mb-3 text-[#D4A574]" />
          <h1 className="text-2xl md:text-3xl font-bold text-white">Kitchen Copilot</h1>
          <p className="text-[#999999] mt-2">
            {orgContext?.hasOrg && orgContext.orgName
              ? `${orgContext.orgName} Kitchen`
              : `${getGreeting()}, Chef. Here's your prep plan for ${getTodayDate()}.`}
          </p>
        </div>

        {/* Data scope toggle — only visible if user has an org */}
        {orgContext?.hasOrg && (
          <div className="flex items-center justify-center gap-2 mb-6">
            <button
              onClick={() => setTeamView(false)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                !teamView
                  ? "bg-[#D4A574] text-white"
                  : "bg-[#161616] text-[#999999] hover:text-white hover:bg-[#1E1E1E]"
              }`}
            >
              My Data
            </button>
            <button
              onClick={() => setTeamView(true)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                teamView
                  ? "bg-[#D4A574] text-white"
                  : "bg-[#161616] text-[#999999] hover:text-white hover:bg-[#1E1E1E]"
              }`}
            >
              Team Data{orgContext.memberCount > 0 ? ` (${orgContext.memberCount})` : ""}
            </button>
            {orgContext.isOrgAdmin && (
              <span className="ml-1 inline-flex items-center gap-1 px-2 py-1 bg-[#D4A574]/20 border border-[#D4A574]/30 rounded text-xs text-[#D4A574] font-medium">
                <Shield className="size-3" />
                Admin
              </span>
            )}
          </div>
        )}

        {/* Tab navigation */}
        <div className="flex justify-center gap-2 mb-8 flex-wrap">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-2.5 rounded-full text-sm font-medium transition-colors min-h-[44px] ${
                activeTab === tab.key
                  ? "bg-[#D4A574] text-white"
                  : "bg-[#161616] text-[#999999] hover:text-white hover:bg-[#1E1E1E]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300 text-sm mb-6">
            {error}
          </div>
        )}

        {/* Tab content */}
        {activeTab === "prep" && (
          <>
            {/* State: loading */}
            {copilotState === "loading" && (
              <div className="flex justify-center py-16">
                <Loader2 className="size-8 animate-spin text-[#D4A574]" />
              </div>
            )}

            {/* State: no-session */}
            {copilotState === "no-session" && (
              <div className="text-center py-16">
                <ChefHat className="size-12 mx-auto text-[#D4A574] mb-4" />
                <h2 className="text-xl font-bold text-white mb-2">
                  Ready to plan today&apos;s prep?
                </h2>
                <p className="text-[#999999] mb-6 max-w-md mx-auto">
                  Select dishes from your menu, set portion counts, and let the Copilot
                  generate a prioritized prep list for your kitchen.
                </p>
                <button
                  onClick={createSession}
                  disabled={creatingSession}
                  className="inline-flex items-center gap-2 px-8 py-4 bg-[#D4A574] hover:bg-[#C4956A] disabled:bg-[#2A2A2A] disabled:cursor-not-allowed text-[#0A0A0A] font-semibold rounded-xl text-lg transition-colors min-h-[44px]"
                >
                  {creatingSession ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <ClipboardList className="size-5" />
                  )}
                  Plan Today&apos;s Prep
                </button>
              </div>
            )}

            {/* State: selecting */}
            {copilotState === "selecting" && sessionData && (
              <PrepMenuSelector
                sessionId={sessionData.session.prepSessionId}
                onGenerated={handleGenerated}
              />
            )}

            {/* State: prepping */}
            {copilotState === "prepping" && (
              <PrepDashboard
                sessionData={sessionData}
                onSessionUpdate={setSessionData}
                teamView={teamView}
              />
            )}
          </>
        )}

        {activeTab === "cross-usage" && (
          <CrossUsageView sessionId={sessionData?.session?.prepSessionId ?? null} teamView={teamView} />
        )}
        {activeTab === "high-impact" && <HighImpactView teamView={teamView} />}
        {activeTab === "history" && <PrepHistory teamView={teamView} />}
      </div>
    </div>
  );
}

/**
 * @module pages/KitchenCopilotPage
 *
 * Kitchen Operations Copilot Lite — daily prep planning, cross-usage
 * analysis, high-impact dish insights, and session history.
 *
 * Four tabs: Today's Prep | Cross-Usage | High-Impact | History
 * Guest users see a sign-up prompt instead of content.
 */

import { useState, useEffect, useCallback } from "react";
import { ClipboardList, LogIn, Loader2 } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "../context/AuthContext.js";
import { PrepDashboard } from "../components/copilot/PrepDashboard.js";
import { CrossUsageView } from "../components/copilot/CrossUsageView.js";
import { HighImpactView } from "../components/copilot/HighImpactView.js";
import { PrepHistory } from "../components/copilot/PrepHistory.js";

type CopilotTab = "prep" | "cross-usage" | "high-impact" | "history";

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
  const [sessionData, setSessionData] = useState<PrepSessionWithTasks | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [coversInput, setCoversInput] = useState("");
  const [creating, setCreating] = useState(false);

  /** Load today's existing prep session on mount. */
  const loadTodaySession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/prep/sessions/today", { credentials: "include" });
      if (res.status === 404) {
        setSessionData(null);
        return;
      }
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
      }
      const data: PrepSessionWithTasks = await res.json();
      setSessionData(data);
      setCoversInput(String(data.session.expectedCovers ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isGuest && user) {
      loadTodaySession();
    } else {
      setLoading(false);
    }
  }, [isGuest, user, loadTodaySession]);

  /** Create a new prep session for today. */
  const createSession = async () => {
    const covers = Number(coversInput);
    if (!covers || covers < 1) return;

    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/prep/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          prepDate: new Date().toISOString().split("T")[0],
          expectedCovers: covers,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `Failed (${res.status})`);
      }
      const data: PrepSessionWithTasks = await res.json();
      setSessionData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setCreating(false);
    }
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
            {getGreeting()}, Chef. Here&apos;s your prep plan for {getTodayDate()}.
          </p>
        </div>

        {/* Covers input — show when no active session */}
        {!loading && !sessionData && (
          <div className="bg-[#161616] rounded-xl p-6 border border-[#2A2A2A] mb-8 max-w-md mx-auto">
            <label htmlFor="covers-input" className="block text-sm font-medium text-[#E5E5E5] mb-2">
              How many covers tonight?
            </label>
            <div className="flex gap-3">
              <input
                id="covers-input"
                type="number"
                min={1}
                placeholder="e.g. 120"
                value={coversInput}
                onChange={(e) => setCoversInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createSession(); }}
                className="flex-1 px-4 py-3 bg-[#1E1E1E] border border-[#2A2A2A] rounded-lg text-white text-lg focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent placeholder-[#666666] min-h-[44px]"
              />
              <button
                onClick={createSession}
                disabled={creating || !coversInput || Number(coversInput) < 1}
                className="px-6 py-3 bg-[#D4A574] hover:bg-[#C4956A] disabled:bg-[#2A2A2A] disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors min-h-[44px]"
              >
                {creating ? <Loader2 className="size-5 animate-spin" /> : "Start Prep"}
              </button>
            </div>
            {error && (
              <p className="text-red-400 text-sm mt-3">{error}</p>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="size-8 animate-spin text-[#D4A574]" />
          </div>
        )}

        {/* Error (when session exists) */}
        {!loading && error && sessionData && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300 text-sm mb-6">
            {error}
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

        {/* Tab content */}
        {activeTab === "prep" && (
          <PrepDashboard sessionData={sessionData} onSessionUpdate={setSessionData} />
        )}
        {activeTab === "cross-usage" && (
          <CrossUsageView sessionId={sessionData?.session?.prepSessionId ?? null} />
        )}
        {activeTab === "high-impact" && <HighImpactView />}
        {activeTab === "history" && <PrepHistory />}
      </div>
    </div>
  );
}

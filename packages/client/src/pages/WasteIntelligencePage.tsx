/**
 * @module pages/WasteIntelligencePage
 *
 * Waste Intelligence Lite — track kitchen waste, view analytics,
 * and get AI-powered reuse suggestions.
 *
 * Three tabs: Log Waste | Dashboard | Reuse Ideas
 * Guest users see a sign-up prompt instead of content.
 */

import { useState } from "react";
import { Leaf, LogIn } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "../context/AuthContext.js";
import { WasteLogger } from "../components/waste/WasteLogger.js";
import { WasteDashboard } from "../components/waste/WasteDashboard.js";
import { WasteReuseSuggestions } from "../components/waste/WasteReuseSuggestions.js";

type WasteTab = "log" | "dashboard" | "reuse";

const TABS: { key: WasteTab; label: string }[] = [
  { key: "log", label: "Log Waste" },
  { key: "dashboard", label: "Dashboard" },
  { key: "reuse", label: "Reuse Ideas" },
];

export function WasteIntelligencePage() {
  const { user, isGuest } = useAuth();
  const [activeTab, setActiveTab] = useState<WasteTab>("log");

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
          <p className="text-gray-400 mt-2">Track waste. Cut costs. Reuse smarter.</p>
        </div>

        {/* Tab navigation */}
        <div className="flex justify-center gap-2 mb-8">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-2.5 rounded-full text-sm font-medium transition-colors ${
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
        {activeTab === "log" && <WasteLogger />}
        {activeTab === "dashboard" && <WasteDashboard />}
        {activeTab === "reuse" && <WasteReuseSuggestions />}
      </div>
    </div>
  );
}

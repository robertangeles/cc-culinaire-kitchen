/**
 * @module UserGuideTab
 *
 * Admin editor for user-facing guide content. Provides a split-screen
 * markdown editor with live preview for each Intelligence module guide.
 */

import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Save, Loader2 } from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";

interface Guide {
  guideKey: string;
  title: string;
  content: string;
  updatedDttm?: string;
}

const SUB_TABS = [
  { key: "waste_intelligence", label: "Waste Intelligence" },
  { key: "kitchen_copilot", label: "Kitchen Copilot" },
  { key: "menu_intelligence", label: "Menu Intelligence" },
] as const;

type GuideKey = (typeof SUB_TABS)[number]["key"];

export function UserGuideTab() {
  const [activeKey, setActiveKey] = useState<GuideKey>("waste_intelligence");
  const [guides, setGuides] = useState<Record<string, Guide>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [lastSaved, setLastSaved] = useState<Record<string, Date>>({});

  // Fetch all guides on mount
  useEffect(() => {
    async function fetchGuides() {
      try {
        const res = await fetch(`${API}/api/guides`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load guides");
        const data: Guide[] = await res.json();
        const map: Record<string, Guide> = {};
        for (const g of data) {
          map[g.guideKey] = g;
          if (g.updatedDttm) {
            lastSaved[g.guideKey] = new Date(g.updatedDttm);
          }
        }
        // Initialize any missing guides with defaults
        for (const tab of SUB_TABS) {
          if (!map[tab.key]) {
            map[tab.key] = { guideKey: tab.key, title: tab.label, content: "" };
          }
        }
        setGuides(map);
        setLastSaved({ ...lastSaved });
      } catch {
        setFeedback({ type: "error", message: "Failed to load guides" });
      } finally {
        setLoading(false);
      }
    }
    fetchGuides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentGuide = guides[activeKey];

  const updateField = useCallback(
    (field: "title" | "content", value: string) => {
      setGuides((prev) => ({
        ...prev,
        [activeKey]: { ...prev[activeKey], [field]: value },
      }));
      setFeedback(null);
    },
    [activeKey],
  );

  const handleSave = async () => {
    if (!currentGuide) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch(`${API}/api/guides/${activeKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: currentGuide.title, content: currentGuide.content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      const now = new Date();
      setLastSaved((prev) => ({ ...prev, [activeKey]: now }));
      setFeedback({ type: "success", message: "Guide saved successfully" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setFeedback({ type: "error", message: msg });
    } finally {
      setSaving(false);
    }
  };

  function formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-6 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-[#FAFAFA]">User Guide</h1>
        <p className="text-sm text-[#999999] mt-1">
          Edit the contextual guide content displayed alongside Intelligence pages.
        </p>
      </div>

      {/* Sub-tab pills */}
      <div className="flex gap-2">
        {SUB_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              setActiveKey(key);
              setFeedback(null);
            }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeKey === key
                ? "bg-[#1E1E1E] text-[#FAFAFA] shadow-sm"
                : "text-[#999999] hover:bg-[#1E1E1E]/60 hover:text-[#FAFAFA]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {currentGuide && (
        <div className="bg-[#161616] border border-[#2A2A2A] rounded-xl p-5 space-y-4">
          {/* Title input + Save button row */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-xs text-[#999999] mb-1 uppercase tracking-wider">
                Title
              </label>
              <input
                type="text"
                value={currentGuide.title}
                onChange={(e) => updateField("title", e.target.value)}
                className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-[#FAFAFA] placeholder-[#666666] focus:outline-none focus:border-[#D4A574] transition-colors"
                placeholder="Guide title"
              />
            </div>
            <div className="flex items-center gap-3 pt-5">
              {/* Auto-save indicator */}
              {lastSaved[activeKey] && (
                <span className="text-xs text-[#666666] whitespace-nowrap">
                  Last saved: {formatTimeAgo(lastSaved[activeKey])}
                </span>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-[#D4A574] text-[#0A0A0A] hover:bg-[#C4956A] disabled:opacity-50"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save
              </button>
            </div>
          </div>

          {/* Feedback */}
          {feedback && (
            <div
              className={`text-sm px-3 py-2 rounded-lg ${
                feedback.type === "success"
                  ? "bg-green-900/30 text-green-400 border border-green-800"
                  : "bg-red-900/30 text-red-400 border border-red-800"
              }`}
            >
              {feedback.message}
            </div>
          )}

          {/* Split-screen editor */}
          <div className="grid grid-cols-2 gap-4">
            {/* Left: Markdown textarea */}
            <div className="space-y-1">
              <label className="block text-xs text-[#999999] uppercase tracking-wider">
                Markdown
              </label>
              <textarea
                value={currentGuide.content}
                onChange={(e) => updateField("content", e.target.value)}
                className="w-full min-h-[400px] bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-4 py-3 font-mono text-sm text-[#E5E5E5] placeholder-[#666666] resize-y focus:outline-none focus:border-[#D4A574] transition-colors"
                placeholder="Write your guide content in markdown..."
              />
            </div>

            {/* Right: Live preview */}
            <div className="space-y-1">
              <label className="block text-xs text-[#999999] uppercase tracking-wider">
                Preview
              </label>
              <div className="min-h-[400px] bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-4 py-3 overflow-y-auto prose prose-invert prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {currentGuide.content || "*No content yet*"}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

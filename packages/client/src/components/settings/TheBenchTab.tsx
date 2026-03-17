/**
 * @module components/settings/TheBenchTab
 *
 * Admin settings for The Bench community chat.
 * Editable announcement/banner text for the public channel.
 */

import { useState, useEffect } from "react";
import { Loader2, Save, CheckCircle2, AlertCircle } from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";

export function TheBenchTab() {
  const [publicBanner, setPublicBanner] = useState("");
  const [orgBanner, setOrgBanner] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API}/api/settings`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        const s = data.settings ?? data;
        setPublicBanner(
          s.bench_public_banner ??
          "This is the public channel — open to all registered chefs. Keep it professional and supportive.",
        );
        setOrgBanner(
          s.bench_org_banner ??
          "This is your organisation's private channel. Only members of your team can see these messages.",
        );
      } catch {
        // Use defaults
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSuccessMsg("");
    setErrorMsg("");
    try {
      const res = await fetch(`${API}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          bench_public_banner: publicBanner,
          bench_org_banner: orgBanner,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to save");
      }
      setSuccessMsg("Bench settings saved.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-stone-400">
        <Loader2 className="size-5 animate-spin mr-2" />
        Loading bench settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-stone-800">The Bench Settings</h2>
        <p className="text-sm text-stone-500 mt-1">
          Manage announcements and banner messages for the community chat.
        </p>
      </div>

      {/* Status messages */}
      {successMsg && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="size-4 flex-shrink-0" /> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="size-4 flex-shrink-0" /> {errorMsg}
        </div>
      )}

      {/* Public channel banner */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">
          Public Channel Banner
        </label>
        <p className="text-xs text-stone-400 mb-2">
          This message appears at the top of the "Everyone" channel. Use it for announcements, guidelines, or community updates.
        </p>
        <textarea
          value={publicBanner}
          onChange={(e) => setPublicBanner(e.target.value)}
          rows={3}
          maxLength={500}
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
          placeholder="e.g., Welcome to The Bench! Share techniques, ask questions, and support your fellow chefs."
        />
        <div className="flex justify-end mt-1">
          <span className={`text-xs ${publicBanner.length > 450 ? "text-amber-600" : "text-stone-400"}`}>
            {publicBanner.length}/500
          </span>
        </div>
      </div>

      {/* Organisation channel banner */}
      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">
          Organisation Channel Banner
        </label>
        <p className="text-xs text-stone-400 mb-2">
          This message appears at the top of every organisation's "My Kitchen" channel.
        </p>
        <textarea
          value={orgBanner}
          onChange={(e) => setOrgBanner(e.target.value)}
          rows={3}
          maxLength={500}
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
          placeholder="e.g., This is your team's private space. Coordinate service, share recipes, and plan menus."
        />
        <div className="flex justify-end mt-1">
          <span className={`text-xs ${orgBanner.length > 450 ? "text-amber-600" : "text-stone-400"}`}>
            {orgBanner.length}/500
          </span>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end pt-2 border-t border-stone-100">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save Bench Settings
        </button>
      </div>
    </div>
  );
}

/**
 * @module components/brain/NudgeOptIn
 *
 * Per-user opt-in for proactive Brain nudges (Phase 3 T17). Off by default;
 * nudges only reach a user who turns this on AND while the admin master flag
 * (`brain_nudges_enabled`) is on. Delivered to the notification bell, never
 * interrupting. Reads/writes GET|PUT /api/brain/nudges/opt-in.
 */

import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2 } from "lucide-react";

export function NudgeOptIn() {
  const [optIn, setOptIn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/brain/nudges/opt-in", { credentials: "include" });
        setOptIn(res.ok ? ((await res.json()).optIn as boolean) : false);
      } catch {
        setOptIn(false);
      }
    })();
  }, []);

  const toggle = useCallback(async () => {
    if (optIn === null || saving) return;
    const next = !optIn;
    setSaving(true);
    setOptIn(next); // optimistic
    try {
      const res = await fetch("/api/brain/nudges/opt-in", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optIn: next }),
      });
      if (!res.ok) setOptIn(!next); // revert
    } catch {
      setOptIn(!next);
    } finally {
      setSaving(false);
    }
  }, [optIn, saving]);

  if (optIn === null) return null; // don't flash before the current value is known

  return (
    <div className="mt-8 flex items-start justify-between gap-4 rounded-xl border border-[#1E1E1E] bg-[#111111] px-4 py-3">
      <div className="flex items-start gap-2.5">
        <Bell className="mt-0.5 size-4 flex-shrink-0 text-[#D4A574]" aria-hidden="true" />
        <div>
          <p className="text-sm text-[#E5E5E5]">Proactive nudges</p>
          <p className="mt-0.5 text-xs text-[#999999]">
            Get the occasional actionable suggestion from your kitchen's recent activity, in your
            notifications. Off by default; never interrupts.
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={optIn}
        aria-label="Toggle proactive nudges"
        onClick={toggle}
        disabled={saving}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60 disabled:opacity-50 ${
          optIn ? "bg-[#D4A574]" : "bg-[#333333]"
        }`}
      >
        <span
          className={`inline-flex size-4 items-center justify-center rounded-full bg-white transition-transform ${
            optIn ? "translate-x-6" : "translate-x-1"
          }`}
        >
          {saving && <Loader2 className="size-3 animate-spin text-[#666]" />}
        </span>
      </button>
    </div>
  );
}

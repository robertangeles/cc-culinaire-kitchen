/**
 * @module components/location/LocationHoursEditor
 *
 * 7-day operating hours grid editor with toggle switches per day.
 */

import { useState, useEffect } from "react";
import { Clock, Loader2, Save } from "lucide-react";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface HourEntry {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

interface LocationHoursEditorProps {
  storeLocationId: string;
  onSaved?: () => void;
}

export function LocationHoursEditor({
  storeLocationId,
  onSaved,
}: LocationHoursEditorProps) {
  const [hours, setHours] = useState<HourEntry[]>(
    DAYS.map((_, i) => ({
      dayOfWeek: i,
      openTime: "09:00",
      closeTime: "22:00",
      isClosed: false,
    }))
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/store-locations/${storeLocationId}/hours`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.hours?.length > 0) {
          setHours(
            DAYS.map((_, i) => {
              const existing = data.hours.find(
                (h: { dayOfWeek: number }) => h.dayOfWeek === i
              );
              return existing
                ? {
                    dayOfWeek: i,
                    openTime: existing.openTime,
                    closeTime: existing.closeTime,
                    isClosed: existing.isClosedInd ?? false,
                  }
                : {
                    dayOfWeek: i,
                    openTime: "09:00",
                    closeTime: "22:00",
                    isClosed: false,
                  };
            })
          );
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [storeLocationId]);

  const updateDay = (dayOfWeek: number, updates: Partial<HourEntry>) => {
    setHours((prev) =>
      prev.map((h) =>
        h.dayOfWeek === dayOfWeek ? { ...h, ...updates } : h
      )
    );
    setSaved(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(
        `/api/store-locations/${storeLocationId}/hours`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hours }),
        }
      );
      if (res.ok) {
        setSaved(true);
        onSaved?.();
      }
    } catch {
      // Silent fail
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-5 h-5 text-gold animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-dark-600">
        <Clock className="w-4 h-4 text-gold" />
        <span className="font-medium">Operating Hours</span>
      </div>

      <div className="space-y-2">
        {hours.map((h) => (
          <div
            key={h.dayOfWeek}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg
              border transition-colors duration-200
              ${
                h.isClosed
                  ? "bg-dark/50 border-dark-200/50 opacity-60"
                  : "bg-dark-50 border-dark-200"
              }`}
            style={{
              borderLeftColor: h.isClosed ? undefined : "#D4A574",
              borderLeftWidth: h.isClosed ? undefined : "2px",
            }}
          >
            {/* Day name */}
            <span
              className={`w-20 text-xs font-medium shrink-0
                ${h.isClosed ? "text-dark-500 line-through" : "text-dark-600"}`}
            >
              {DAYS[h.dayOfWeek]}
            </span>

            {/* Toggle */}
            <button
              onClick={() =>
                updateDay(h.dayOfWeek, { isClosed: !h.isClosed })
              }
              className={`w-8 h-4 rounded-full transition-colors duration-200
                relative shrink-0
                ${h.isClosed ? "bg-dark-200" : "bg-gold/40"}`}
            >
              <div
                className={`w-3.5 h-3.5 rounded-full absolute top-0.5
                  transition-all duration-200
                  ${
                    h.isClosed
                      ? "left-0.5 bg-dark-400"
                      : "left-[18px] bg-gold shadow-[0_0_6px_rgba(212,165,116,0.4)]"
                  }`}
              />
            </button>

            {/* Times */}
            {!h.isClosed && (
              <>
                <input
                  type="time"
                  value={h.openTime}
                  onChange={(e) =>
                    updateDay(h.dayOfWeek, { openTime: e.target.value })
                  }
                  className="px-2 py-1 text-xs rounded-md
                    bg-dark border border-dark-200 text-white
                    focus:outline-none focus:ring-1 focus:ring-gold-ring"
                />
                <span className="text-xs text-dark-500">to</span>
                <input
                  type="time"
                  value={h.closeTime}
                  onChange={(e) =>
                    updateDay(h.dayOfWeek, { closeTime: e.target.value })
                  }
                  className="px-2 py-1 text-xs rounded-md
                    bg-dark border border-dark-200 text-white
                    focus:outline-none focus:ring-1 focus:ring-gold-ring"
                />
              </>
            )}

            {h.isClosed && (
              <span className="text-xs text-dark-500 italic">Closed</span>
            )}
          </div>
        ))}
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={isSaving || saved}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm
          font-medium transition-colors duration-200 min-h-[44px]
          ${
            saved
              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
              : "bg-gold hover:bg-gold-hover text-dark"
          }
          disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {isSaving ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : saved ? (
          "Saved"
        ) : (
          <>
            <Save className="w-3.5 h-3.5" />
            Save Hours
          </>
        )}
      </button>
    </div>
  );
}

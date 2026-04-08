/**
 * @module components/location/LocationPulse
 *
 * Lightweight badge showing staff count and last activity for a location.
 * Fetched on mount, cached for the session.
 */

import { useState, useEffect } from "react";
import { Users } from "lucide-react";

interface PulseData {
  staffCount: number;
  lastActivity: string | null;
}

const cache = new Map<string, PulseData>();

function formatLastActivity(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function LocationPulse({
  storeLocationId,
}: {
  storeLocationId: string;
}) {
  const [pulse, setPulse] = useState<PulseData | null>(
    cache.get(storeLocationId) ?? null
  );

  useEffect(() => {
    if (cache.has(storeLocationId)) {
      setPulse(cache.get(storeLocationId)!);
      return;
    }

    let cancelled = false;
    fetch(`/api/store-locations/${storeLocationId}/pulse`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && !cancelled) {
          cache.set(storeLocationId, data);
          setPulse(data);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [storeLocationId]);

  if (!pulse) return null;

  return (
    <span className="flex items-center gap-1 text-[10px] text-dark-500">
      <Users className="w-2.5 h-2.5" />
      {pulse.staffCount}
      {pulse.lastActivity && (
        <>
          <span className="text-dark-400">·</span>
          {formatLastActivity(pulse.lastActivity)}
        </>
      )}
    </span>
  );
}

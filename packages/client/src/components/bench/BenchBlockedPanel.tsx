/**
 * The people I blocked on The Bench, each with Unblock.
 */

import { UserX } from "lucide-react";
import type { BenchPerson } from "../../hooks/useBenchSafety.js";

interface BenchBlockedPanelProps {
  blocked: BenchPerson[];
  onUnblock: (person: BenchPerson) => void;
}

export function BenchBlockedPanel({ blocked, onUnblock }: BenchBlockedPanelProps) {
  return (
    <section aria-label="Blocked people" className="mt-3 rounded-xl border border-white/5 bg-dark/60 backdrop-blur p-3 animate-fade-in-up">
      <h2 className="text-xs font-semibold text-gold mb-2">Blocked people</h2>
      {blocked.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-dark-600">
          <UserX className="size-4 text-gold/50" /> You haven't blocked anyone.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {blocked.map((p) => (
            <li key={p.userId} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors">
              {p.userPhotoPath ? (
                <img src={p.userPhotoPath} alt="" className="size-8 rounded-full object-cover" />
              ) : (
                <div className="size-8 rounded-full bg-gold/15 flex items-center justify-center">
                  <span className="text-xs font-semibold text-gold">{p.userName.charAt(0).toUpperCase()}</span>
                </div>
              )}
              <span className="flex-1 text-sm text-[#E5E5E5] truncate">{p.userName}</span>
              <button
                type="button"
                onClick={() => onUnblock(p)}
                aria-label={`Unblock ${p.userName}`}
                className="px-3 py-1 rounded-lg border border-white/10 text-xs font-medium text-[#E5E5E5] hover:border-gold/40 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 transition-colors"
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

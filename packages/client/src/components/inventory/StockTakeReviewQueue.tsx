/**
 * @module components/inventory/StockTakeReviewQueue
 *
 * Cross-location review queue for HQ admins. Shows all sessions
 * pending review as compact cards. Expand one at a time to review
 * full details via StockTakeReview.
 */

import { useState } from "react";
import { type PendingReviewSession } from "../../hooks/useInventory.js";
import { StockTakeReview } from "./StockTakeReview.js";
import {
  CheckCircle2, MapPin, User, Clock,
  ChevronDown, ChevronRight, Flag,
} from "lucide-react";

interface Props {
  sessions: PendingReviewSession[];
  refresh: () => Promise<void> | void;
}

export function StockTakeReviewQueue({ sessions, refresh }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (sessions.length === 0) {
    return (
      <div className="text-center py-16 animate-[fadeInUp_200ms_ease-out]">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center shadow-[0_0_20px_rgba(52,211,153,0.1)]">
          <CheckCircle2 className="size-10 text-emerald-400" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">All Clear</h3>
        <p className="text-sm text-[#999] max-w-md mx-auto">
          No stock takes pending review. All locations are up to date.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-[fadeInUp_200ms_ease-out]">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Pending Reviews</h3>
        <span className="text-xs px-2.5 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 font-medium">
          {sessions.length} pending
        </span>
      </div>

      {sessions.map((session) => (
        <ReviewCard
          key={session.sessionId}
          session={session}
          isExpanded={expandedId === session.sessionId}
          onToggle={() =>
            setExpandedId(expandedId === session.sessionId ? null : session.sessionId)
          }
          onActionComplete={() => {
            setExpandedId(null);
            refresh();
          }}
        />
      ))}
    </div>
  );
}

function ReviewCard({
  session,
  isExpanded,
  onToggle,
  onActionComplete,
}: {
  session: PendingReviewSession;
  isExpanded: boolean;
  onToggle: () => void;
  onActionComplete: () => void;
}) {
  const isFlagged = session.sessionStatus === "FLAGGED";
  const timeAgo = formatTimeAgo(session.submittedDttm ?? session.openedDttm);

  // Build a full StockTakeSession shape for StockTakeReview
  const fullSession = {
    ...session,
    organisationId: 0, // not needed by review component
    openedByUserId: session.openedByUserId,
    approvedByUserId: null,
    closedDttm: null,
    openedByUserName: session.openedByUserName,
    locationName: session.locationName,
  };

  return (
    <div
      className={`rounded-xl border overflow-hidden transition-all ${
        isFlagged
          ? "bg-red-500/5 border-red-500/20"
          : "bg-[#161616] border-[#2A2A2A]"
      } ${!isExpanded ? "hover:-translate-y-0.5 hover:shadow-lg" : ""}`}
    >
      {/* Compact card header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-[#1E1E1E]/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          {/* Row 1: location, opener, time */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1.5 text-sm font-medium text-white">
              <MapPin className="size-3.5 text-[#D4A574] shrink-0" />
              {session.locationName}
            </span>
            <span className="flex items-center gap-1 text-xs text-[#999]">
              <User className="size-3 shrink-0" />
              {session.openedByUserName}
            </span>
            <span className="flex items-center gap-1 text-xs text-[#666]">
              <Clock className="size-3 shrink-0" />
              {timeAgo}
            </span>
          </div>

          {/* Row 2: type + counts + flag */}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xs text-[#666]">
              {session.categoryCount === 10 ? "Full Inventory" : "Cycle Count"}
              {" · "}
              {session.submittedCount} categor{session.submittedCount === 1 ? "y" : "ies"}
            </span>
            {isFlagged && (
              <span className="flex items-center gap-1 text-xs text-red-400">
                <Flag className="size-3" />
                {session.flagReason}
              </span>
            )}
          </div>
        </div>

        <div className="ml-3 shrink-0">
          {isExpanded
            ? <ChevronDown className="size-5 text-[#999]" />
            : <ChevronRight className="size-5 text-[#999]" />
          }
        </div>
      </button>

      {/* Expanded: full review panel */}
      {isExpanded && (
        <div className="border-t border-[#2A2A2A] p-4 animate-[fadeIn_150ms_ease-out]">
          <StockTakeReview
            session={fullSession as any}
            onActionComplete={onActionComplete}
          />
        </div>
      )}
    </div>
  );
}

/** Format a timestamp as relative time (e.g., "2h ago", "1d ago"). */
function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  return new Date(dateStr).toLocaleDateString();
}

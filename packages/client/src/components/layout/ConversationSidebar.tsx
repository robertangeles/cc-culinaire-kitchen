/**
 * @module ConversationSidebar
 *
 * Right-hand sidebar showing the conversation history list, free-session
 * banners, and guest session info. Replaces the conversation section that
 * was previously in the left {@link Sidebar}.
 *
 * Rendered inside the main app layout on medium+ screens.
 */

import { Link } from "react-router";
import { UserPlus } from "lucide-react";
import { useAuth } from "../../context/AuthContext.js";
import { ConversationList } from "./ConversationList.js";

/**
 * Fixed right-hand sidebar containing the conversation history list
 * and session usage banners.
 */
export function ConversationSidebar() {
  const { user, isGuest, guestUsage } = useAuth();

  return (
    <aside className="hidden md:flex w-64 h-full flex-col bg-stone-800 text-white border-l border-stone-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-stone-700">
        <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
          Conversations
        </h2>
      </div>

      {/* Conversation list — grows to fill */}
      <div className="flex-1 flex flex-col min-h-0">
        <ConversationList />
      </div>

      {/* Session footer */}
      {isGuest && guestUsage ? (
        <div className="px-4 py-3 border-t border-stone-700 text-xs">
          <p className="text-stone-300">
            <span className="text-amber-400 font-semibold">{guestUsage.sessionsRemaining}</span>{" "}
            of {guestUsage.sessionsLimit} guest session
            {guestUsage.sessionsRemaining !== 1 ? "s" : ""} remaining
          </p>
          <Link
            to="/register"
            className="mt-1 inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 font-medium transition-colors"
          >
            <UserPlus className="size-3" />
            Register for free
          </Link>
        </div>
      ) : user && user.subscriptionStatus !== "active" ? (
        <div className="px-4 py-3 border-t border-stone-700 text-xs">
          <p className="text-stone-300">
            {user.freeSessions > 0 ? (
              <>
                <span className="text-amber-400 font-semibold">{user.freeSessions}</span> free
                session{user.freeSessions !== 1 ? "s" : ""} remaining
              </>
            ) : (
              <span className="text-red-400">No free sessions remaining</span>
            )}
          </p>
          {user.freeSessions <= 2 && (
            <button
              onClick={() => (window.location.href = "/profile")}
              className="mt-1 text-amber-400 hover:text-amber-300 font-medium transition-colors"
            >
              Upgrade now
            </button>
          )}
        </div>
      ) : null}
    </aside>
  );
}

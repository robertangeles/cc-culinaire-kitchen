/**
 * @module ConversationSidebar
 *
 * Collapsible right-hand sidebar showing conversation history,
 * free-session banners, and guest session info.
 * Toggle button is always visible so users can expand/collapse.
 */

import { useState } from "react";
import { Link } from "react-router";
import { UserPlus, PanelRightOpen, PanelRightClose } from "lucide-react";
import { useAuth } from "../../context/AuthContext.js";
import { ConversationList } from "./ConversationList.js";

export function ConversationSidebar() {
  const { user, isGuest, guestUsage } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="hidden md:flex h-full flex-shrink-0">
      {/* Toggle button — always visible */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-start pt-3 px-1 bg-dark border-l border-dark-100 text-dark-500 hover:text-white transition-colors"
        title={collapsed ? "Show conversations" : "Hide conversations"}
      >
        {collapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}
      </button>

      {/* Sidebar panel */}
      <aside
        className={`flex flex-col bg-dark text-white border-l border-dark-100 overflow-hidden transition-all duration-200 ${
          collapsed ? "w-0" : "w-64"
        }`}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-dark-100 flex-shrink-0">
          <h2 className="text-xs font-semibold text-dark-600 uppercase tracking-wider whitespace-nowrap">
            Conversations
          </h2>
        </div>

        {/* Conversation list — grows to fill */}
        <div className="flex-1 flex flex-col min-h-0">
          <ConversationList />
        </div>

        {/* Session footer */}
        {isGuest && guestUsage ? (
          <div className="px-4 py-3 border-t border-dark-100 text-xs flex-shrink-0">
            <p className="text-dark-600">
              <span className="text-gold font-semibold">{guestUsage.sessionsRemaining}</span>{" "}
              of {guestUsage.sessionsLimit} guest session
              {guestUsage.sessionsRemaining !== 1 ? "s" : ""} remaining
            </p>
            <Link
              to="/register"
              className="mt-1 inline-flex items-center gap-1 text-gold hover:text-gold-hover font-medium transition-colors"
            >
              <UserPlus className="size-3" />
              Register for free
            </Link>
          </div>
        ) : user && user.subscriptionTier !== "paid" ? (
          <div className="px-4 py-3 border-t border-dark-100 text-xs flex-shrink-0">
            <p className="text-dark-600">
              {user.freeSessions > 0 ? (
                <>
                  <span className="text-gold font-semibold">{user.freeSessions}</span> free
                  session{user.freeSessions !== 1 ? "s" : ""} remaining
                </>
              ) : (
                <span className="text-red-400">No free sessions remaining</span>
              )}
            </p>
            {user.subscriptionStatus !== "active" && user.freeSessions <= 2 && (
              <button
                onClick={() => (window.location.href = "/profile")}
                className="mt-1 text-gold hover:text-gold-hover font-medium transition-colors"
              >
                Upgrade now
              </button>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

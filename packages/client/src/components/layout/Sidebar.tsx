/**
 * @module Sidebar
 *
 * Left-hand application sidebar. Contains dynamic branding (logo + title
 * from site settings, clickable to home), Settings link, and user menu.
 * The conversation list lives in {@link ConversationSidebar} on the right.
 */

import { Link, NavLink } from "react-router";
import { ChefHat, Settings, UtensilsCrossed, Croissant, GlassWater, MessageSquare } from "lucide-react";
import { useSettings } from "../../context/SettingsContext.js";
import { useAuth } from "../../context/AuthContext.js";
import { UserMenu } from "./UserMenu.js";

/** Shared Tailwind class builder for sidebar nav links. */
const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
    isActive
      ? "bg-stone-700 text-white"
      : "text-stone-400 hover:text-white hover:bg-stone-700/50"
  }`;

/**
 * Fixed left-hand sidebar providing brand identity and primary navigation.
 * Hidden on small viewports (mobile) via Tailwind's `hidden md:flex`.
 */
export function Sidebar() {
  const { settings } = useSettings();
  const { user, isGuest } = useAuth();
  const pageTitle = settings.page_title || "CulinAIre";
  const logoPath = settings.logo_path;
  const sidebarBg = settings.sidebar_bg || undefined;
  const isAdmin = user?.roles.includes("Administrator") ?? false;

  return (
    <aside
      className="hidden md:flex w-64 h-full flex-col bg-stone-800 text-white"
      style={sidebarBg ? { backgroundColor: sidebarBg } : undefined}
    >
      {/* Branding — logo on top, title below, clickable to home */}
      <Link
        to="/chat/new"
        className="flex flex-col items-center gap-2 px-4 py-5 border-b border-stone-700 hover:bg-stone-700/50 transition-colors"
      >
        {logoPath ? (
          <img
            src={logoPath}
            alt={pageTitle}
            className="object-contain"
            style={{ width: 100, height: 100 }}
          />
        ) : (
          <ChefHat className="size-12 text-amber-500" />
        )}
        <span className="font-semibold text-lg truncate text-center w-full">{pageTitle}</span>
      </Link>

      {/* Module navigation */}
      <nav className="px-3 pt-4 flex flex-col gap-1">
        <p className="px-3 text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">Modules</p>
        <NavLink to="/chat/new" className={navLinkClass}>
          <MessageSquare className="size-4" />
          Chat Assistant
        </NavLink>
        <NavLink to="/recipes" className={navLinkClass}>
          <UtensilsCrossed className="size-4" />
          Recipe Lab
        </NavLink>
        <NavLink to="/patisserie" className={navLinkClass}>
          <Croissant className="size-4" />
          Patisserie Lab
        </NavLink>
        <NavLink to="/spirits" className={navLinkClass}>
          <GlassWater className="size-4" />
          Spirits Lab
        </NavLink>
      </nav>

      {/* Spacer — pushes settings + user menu to the bottom */}
      <div className="flex-1" />

      {/* Settings — admin only */}
      {isAdmin && (
        <div className="px-3 pb-2">
          <NavLink to="/settings" className={navLinkClass}>
            <Settings className="size-4" />
            Settings
          </NavLink>
        </div>
      )}

      {/* User menu or guest sign-in prompt */}
      {isGuest ? (
        <div className="px-3 pb-2">
          <Link
            to="/login"
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors"
          >
            Sign In
          </Link>
        </div>
      ) : (
        <UserMenu />
      )}

      {/* Footer */}
      <div className="px-4 py-3 border-t border-stone-700 text-xs text-stone-500">
        CulinAIre Kitchen v{__APP_VERSION__}
      </div>
    </aside>
  );
}

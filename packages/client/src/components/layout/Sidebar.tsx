/**
 * @module Sidebar
 *
 * Left-hand application sidebar. Contains dynamic branding (logo + title
 * from site settings, clickable to home), Settings link, and user menu.
 * The conversation list lives in {@link ConversationSidebar} on the right.
 */

import { useState } from "react";
import { Link, NavLink } from "react-router";
import { ChefHat, Settings, UtensilsCrossed, Croissant, GlassWater, MessageSquare, LayoutGrid, BookMarked, MessagesSquare, BarChart3, Leaf, ClipboardList, ChevronDown, ChevronRight } from "lucide-react";
import { useSettings } from "../../context/SettingsContext.js";
import { useAuth } from "../../context/AuthContext.js";
import { UserMenu } from "./UserMenu.js";

/** Shared Tailwind class builder for sidebar nav links. */
const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
    isActive
      ? "bg-[#1E1E1E] text-white"
      : "text-[#999999] hover:text-[#FAFAFA] hover:bg-[#161616]"
  }`;

/** Collapsible group header */
function SidebarGroup({
  label,
  defaultOpen = true,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-medium text-[#666666] uppercase tracking-wider hover:text-[#999999] transition-colors"
      >
        {open ? <ChevronDown className="size-3 text-[#666666]" /> : <ChevronRight className="size-3 text-[#666666]" />}
        {label}
      </button>
      <div
        className="flex flex-col gap-0.5 mt-0.5 overflow-hidden transition-all duration-200"
        style={{ maxHeight: open ? "500px" : "0px", opacity: open ? 1 : 0 }}
      >
        {children}
      </div>
    </div>
  );
}

/** Grouped sidebar navigation */
function SidebarNav({ isGuest, isAuthenticated }: { isGuest: boolean; isAuthenticated: boolean }) {
  return (
    <nav className="px-3 pt-4 flex flex-col gap-1 overflow-y-auto">
      {/* Always visible */}
      <NavLink to="/chat/new" className={navLinkClass}>
        <MessageSquare className="size-4" />
        Chat Assistant
      </NavLink>

      {/* Creative Labs */}
      <SidebarGroup label="Creative Labs">
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
      </SidebarGroup>

      {/* Kitchen Operations — auth required */}
      {!isGuest && isAuthenticated && (
        <SidebarGroup label="Kitchen Operations">
          <NavLink to="/menu-intelligence" className={navLinkClass}>
            <BarChart3 className="size-4" />
            Menu Intelligence
          </NavLink>
          <NavLink to="/kitchen-copilot" className={navLinkClass}>
            <ClipboardList className="size-4" />
            Kitchen Copilot
          </NavLink>
          <NavLink to="/waste-intelligence" className={navLinkClass}>
            <Leaf className="size-4" />
            Waste Intelligence
          </NavLink>
        </SidebarGroup>
      )}

      {/* Community & Shelf */}
      <SidebarGroup label="Community">
        <NavLink to="/kitchen-shelf" className={navLinkClass}>
          <LayoutGrid className="size-4" />
          Kitchen Shelf
        </NavLink>
        {!isGuest && isAuthenticated && (
          <NavLink to="/my-shelf" className={navLinkClass}>
            <BookMarked className="size-4" />
            My Shelf
          </NavLink>
        )}
        <NavLink to="/bench" className={navLinkClass}>
          <MessagesSquare className="size-4" />
          The Bench
        </NavLink>
      </SidebarGroup>
    </nav>
  );
}

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
      className="hidden md:flex w-64 h-full flex-col bg-[#0A0A0A] border-r border-[#1E1E1E] text-white"
      style={sidebarBg ? { backgroundColor: sidebarBg } : undefined}
    >
      {/* Branding — logo on top, title below, clickable to home */}
      <Link
        to="/chat/new"
        className="flex flex-col items-center gap-2 px-4 py-5 border-b border-[#1E1E1E] hover:bg-[#161616] transition-colors"
      >
        {logoPath ? (
          <img
            src={logoPath}
            alt={pageTitle}
            className="object-contain"
            style={{ width: 100, height: 100 }}
          />
        ) : (
          <ChefHat className="size-12 text-[#D4A574]" />
        )}
        <span className="font-semibold text-lg truncate text-center w-full text-[#FAFAFA] tracking-tight">{pageTitle}</span>
        <span className="text-[10px] font-medium text-[#D4A574] bg-[#D4A574]/15 border border-[#D4A574]/20 px-1.5 py-0.5 rounded-full">
          Open Beta
        </span>
      </Link>

      {/* Module navigation */}
      <SidebarNav isGuest={isGuest} isAuthenticated={!!user} />

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
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium bg-[#D4A574] text-[#0A0A0A] hover:bg-[#C4956A] transition-colors"
          >
            Sign In
          </Link>
        </div>
      ) : (
        <UserMenu />
      )}

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[#1E1E1E] text-xs text-[#666666]">
        CulinAIre Kitchen v{__APP_VERSION__}
      </div>
    </aside>
  );
}

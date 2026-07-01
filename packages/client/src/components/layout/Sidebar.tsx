/**
 * @module Sidebar
 *
 * Left-hand application sidebar. Contains dynamic branding (logo + title
 * from site settings, clickable to home), Settings link, and user menu.
 * The conversation list lives in {@link ConversationSidebar} on the right.
 */

import { useState } from "react";
import { Link, NavLink } from "react-router";
import { ChefHat, ChevronDown, ChevronRight } from "lucide-react";
import { useSettings } from "../../context/SettingsContext.js";
import { useAuth } from "../../context/AuthContext.js";
import { UserMenu } from "./UserMenu.js";
import { NAV_SECTIONS, filterNav, type NavItem } from "./navConfig.js";
import { LocationChip } from "../location/LocationChip.js";

/** Shared Tailwind class builder for sidebar nav links. */
const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
    isActive
      ? "bg-[#1E1E1E] text-white"
      : "text-[#999999] hover:text-[#FAFAFA] hover:bg-[#161616]"
  }`;

/**
 * Collapsible group header. Open/closed state is controlled by the parent
 * ({@link SidebarNav}) so the groups behave as an accordion — expanding one
 * collapses the others.
 */
function SidebarGroup({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
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

/** A single nav link rendered from a config item. */
function NavItemLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} className={navLinkClass}>
      <Icon className="size-4" />
      {item.label}
    </NavLink>
  );
}

/**
 * Grouped sidebar navigation, rendered from {@link NAV_SECTIONS} filtered to
 * what the current viewer is allowed to see. Sections with a `null` label are
 * top-level (ungrouped); the rest render as collapsible groups. Empty sections
 * are already dropped by `filterNav`.
 */
function SidebarNav({
  isGuest,
  isAuthenticated,
  permissions,
  roles,
}: {
  isGuest: boolean;
  isAuthenticated: boolean;
  permissions: string[];
  roles: string[];
}) {
  const sections = filterNav(NAV_SECTIONS, { isGuest, isAuthenticated, permissions, roles });
  // Accordion: at most one group open at a time. Clicking an open group closes
  // it; clicking a closed group opens it and collapses the rest. Groups start
  // collapsed so only headers show until the user picks one.
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  return (
    <nav className="px-3 pt-4 flex flex-col gap-1 overflow-y-auto">
      {sections.map((section) =>
        section.label === null ? (
          <div key={section.id} className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <NavItemLink key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <SidebarGroup
            key={section.id}
            label={section.label}
            open={openSectionId === section.id}
            onToggle={() =>
              setOpenSectionId((current) => (current === section.id ? null : section.id))
            }
          >
            {section.items.map((item) => (
              <NavItemLink key={item.id} item={item} />
            ))}
          </SidebarGroup>
        ),
      )}
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
  const permissions = user?.permissions ?? [];
  const roles = user?.roles ?? [];
  const pageTitle = settings.page_title || "CulinAIre";
  const logoPath = settings.logo_path;
  const sidebarBg = settings.sidebar_bg || undefined;

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
      </Link>

      {/* Active kitchen anchor — which location am I in — sits directly under the
          title in place of the old "Open Beta" badge (multi-location only). */}
      <LocationChip />

      {/* Module navigation */}
      <SidebarNav isGuest={isGuest} isAuthenticated={!!user} permissions={permissions} roles={roles} />

      {/* Spacer — pushes settings + user menu to the bottom */}
      <div className="flex-1" />

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

/**
 * @module SettingsLayout
 *
 * Two-column layout for the Settings page. Renders a vertical tab bar on the
 * left and a scrollable content area on the right. Tabs that are not yet
 * implemented are shown in a disabled state with a "Soon" badge.
 *
 * Tabs are organised into groups (Web / Mobile / Rostering & Compliance /
 * Shared / Unassigned) so an admin can see, at a glance, which app — or which
 * feature domain — each setting affects. Group placement is driven by the
 * optional `group` field on each tab — empty groups are not rendered, and
 * tabs without a group fall through to "Unassigned".
 *
 * Rostering & Compliance renders as a single collapsed entry in the sidebar
 * (its 4 tabs would otherwise crowd the vertical list); selecting it reveals
 * a horizontal tab strip at the top of the content pane to switch between
 * Compliance / Public Holidays / Award Rules / Document Expiry Rules.
 */

import { type ReactNode, type KeyboardEvent } from "react";
import {
  ScrollText,
  Palette,
  Bot,
  BookOpen,
  Globe,
  Users,
  Shield,
  ShieldCheck,
  Plug,
  MessagesSquare,
  FileText,
  Brain,
  CalendarDays,
  Scale,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { useHasPermission } from "../../hooks/useHasPermission.js";
import { useAuth } from "../../context/AuthContext.js";

/** Which app surface — or feature domain — a settings tab primarily affects. */
export type SettingsGroup = "web" | "mobile" | "rosteringCompliance" | "shared" | "unassigned";

/** Descriptor for a single settings tab. */
interface TabItem {
  /** Unique key used to identify the active tab. */
  id: string;
  /** Human-readable label rendered in the tab bar. */
  label: string;
  /** Lucide icon component displayed beside the label. */
  icon: LucideIcon;
  /** When true the tab is visible but not interactive. */
  disabled?: boolean;
  /**
   * Which app surface this tab affects. Omit to fall through to the
   * "Unassigned" section so newly-added tabs remain visible until classified.
   */
  group?: SettingsGroup;
  /**
   * Permission key required to see this tab. Omit for tabs every signed-in
   * admin-area visitor may see — /settings itself is only AuthenticatedOnly,
   * so an ungated tab is visible to anyone who can reach the page.
   */
  permission?: string;
  /**
   * When true, ALSO requires the Administrator role, on top of `permission`
   * — for platform-wide, no-organisationId reference data (award_rule,
   * document_expiry_rule) where even a role holding `permission` (e.g.
   * Operations Admin holding compliance:manage-rules) must not see the tab.
   * See requireAdministrator's doc comment (middleware/auth.ts) for the
   * server-side half of this same gate.
   */
  requireAdministrator?: boolean;
}

/** Display order + label for each group section. */
const GROUP_ORDER: { id: SettingsGroup; label: string }[] = [
  { id: "web", label: "Web" },
  { id: "mobile", label: "Mobile" },
  { id: "rosteringCompliance", label: "Rostering & Compliance" },
  { id: "shared", label: "Shared" },
  { id: "unassigned", label: "Unassigned" },
];

/** Registry of all settings tabs. Disabled tabs are planned future features. */
const tabs: TabItem[] = [
  { id: "prompts", label: "Prompts", icon: ScrollText, group: "shared" },
  { id: "mobilePages", label: "Pages", icon: FileText, group: "mobile" },
  { id: "siteSettings", label: "Site Settings", icon: Globe, group: "web" },
  { id: "pages", label: "Pages", icon: FileText, group: "web" },
  { id: "appearance", label: "Appearance", icon: Palette, group: "web" },
  { id: "users", label: "Users", icon: Users, group: "shared" },
  {
    id: "compliance",
    label: "Compliance",
    icon: ShieldCheck,
    group: "rosteringCompliance",
    permission: "compliance:manage-rules",
  },
  {
    id: "publicHolidays",
    label: "Public Holidays",
    icon: CalendarDays,
    group: "rosteringCompliance",
    permission: "roster:manage",
  },
  {
    id: "awardRules",
    label: "Award Rules",
    icon: Scale,
    group: "rosteringCompliance",
    permission: "roster:manage-award-rules",
    requireAdministrator: true,
  },
  {
    id: "documentExpiryRules",
    label: "Document Expiry Rules",
    icon: Clock,
    group: "rosteringCompliance",
    permission: "compliance:manage-rules",
    requireAdministrator: true,
  },
  { id: "roles", label: "Roles", icon: Shield, group: "shared" },
  { id: "integrations", label: "Integrations", icon: Plug, group: "shared" },
  { id: "models", label: "Models", icon: Bot, disabled: true, group: "shared" },
  { id: "knowledge", label: "Knowledge Base", icon: BookOpen, group: "shared" },
  { id: "bench", label: "The Bench", icon: MessagesSquare, group: "web" },
  { id: "userGuide", label: "User Guide", icon: BookOpen, group: "web" },
  { id: "brain", label: "Brain", icon: Brain, group: "web" },
];

/**
 * Group tabs into their display sections, preserving the order tabs are
 * declared in within each group. Empty groups are returned as empty arrays
 * and filtered out at render time.
 *
 * Exported for unit testing — also used internally by {@link orderedTabs}.
 */
export function groupTabs<T extends { group?: SettingsGroup }>(
  items: T[],
): { id: SettingsGroup; label: string; items: T[] }[] {
  return GROUP_ORDER.map((g) => ({
    id: g.id,
    label: g.label,
    items: items.filter((t) => (t.group ?? "unassigned") === g.id),
  }));
}

/**
 * Tabs in their final visual order — used for both render and keyboard nav.
 * Exported for unit testing.
 */
export function orderedTabs<T extends { group?: SettingsGroup }>(items: T[]): T[] {
  return groupTabs(items).flatMap((g) => g.items);
}

/** Props for {@link SettingsLayout}. */
interface SettingsLayoutProps {
  /** The `id` of the currently selected tab. */
  activeTab: string;
  /** Callback fired when the user clicks an enabled tab. */
  onTabChange: (id: string) => void;
  /** Tab content rendered in the right-hand pane. */
  children: ReactNode;
}

/**
 * Settings shell that pairs a left-side tab navigation with a content area.
 * The parent is responsible for mapping `activeTab` to the correct child content.
 */
export function SettingsLayout({
  activeTab,
  onTabChange,
  children,
}: SettingsLayoutProps) {
  // /settings is guarded only by AuthenticatedOnly (App.tsx) — individual
  // tabs are the only gate a permission-scoped tab like Compliance gets, so
  // an ungated tab whose PUT endpoint requires a permission would otherwise
  // be visible (and 403 on save) to every signed-in user.
  const hasPermission = useHasPermission();
  const { user } = useAuth();
  const isAdministrator = user?.roles?.includes("Administrator") ?? false;
  const visibleTabs = tabs.filter(
    (t) =>
      (!t.permission || hasPermission(t.permission)) && (!t.requireAdministrator || isAdministrator),
  );
  // Always render Web, Mobile, and Shared so the cherry-pick targets stay
  // visible even when empty. Rostering & Compliance and Unassigned are both
  // fully permission-gated (every tab in Rostering & Compliance requires a
  // permission, several also requireAdministrator) — a viewer holding none
  // of those would otherwise see an empty section with nothing to explain
  // it, so both fall back to "hidden when empty" instead.
  const groups = groupTabs(visibleTabs).filter(
    (g) => (g.id !== "unassigned" && g.id !== "rosteringCompliance") || g.items.length > 0,
  );

  // Rostering & Compliance renders as ONE sidebar entry (collapsed group)
  // plus a horizontal tab strip in the content pane — see render below.
  const rosteringTabs = groups.find((g) => g.id === "rosteringCompliance")?.items ?? [];
  const isRosteringActive = rosteringTabs.some((t) => t.id === activeTab);
  const ROSTERING_GROUP_ID = "rosteringCompliance-group";

  // Sidebar focus order: the collapsed rostering group counts as a single
  // stop, same as every other tab.
  const navIds = groups.flatMap((g) =>
    g.id === "rosteringCompliance" && g.items.length > 0
      ? [ROSTERING_GROUP_ID]
      : g.items.filter((t) => !t.disabled).map((t) => t.id),
  );

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const currentId = isRosteringActive ? ROSTERING_GROUP_ID : activeTab;
    const currentIndex = navIds.indexOf(currentId);
    const next =
      e.key === "ArrowDown"
        ? (currentIndex + 1) % navIds.length
        : (currentIndex - 1 + navIds.length) % navIds.length;
    const nextId = navIds[next];
    onTabChange(nextId === ROSTERING_GROUP_ID ? rosteringTabs[0].id : nextId);
    document.getElementById(`settings-tab-${nextId}`)?.focus();
  }

  return (
    <div className="flex h-full bg-dark">
      {/* Tab navigation */}
      <div className="w-56 border-r border-dark-200 bg-dark px-3 py-6">
        <h2 className="px-3 mb-4 text-sm font-semibold text-dark-500 uppercase tracking-wider">
          Settings
        </h2>
        <nav role="tablist" aria-label="Settings" aria-orientation="vertical">
          {groups.map((group, idx) => (
            <div
              key={group.id}
              role="group"
              aria-label={group.label}
              className={idx > 0 ? "mt-4 pt-4 border-t border-white/5" : ""}
            >
              <h3 className="px-3 mb-2 text-xs font-semibold text-dark-500 uppercase tracking-wider">
                {group.label}
              </h3>
              {group.items.length === 0 && (
                <p className="px-3 py-2 text-xs italic text-[#555555]">
                  No tabs yet
                </p>
              )}
              <div className="space-y-1">
                {group.id === "rosteringCompliance" && group.items.length > 0 ? (
                  <button
                    role="tab"
                    aria-selected={isRosteringActive}
                    aria-controls={`settings-tabpanel-${activeTab}`}
                    id={`settings-tab-${ROSTERING_GROUP_ID}`}
                    tabIndex={isRosteringActive ? 0 : -1}
                    onClick={() => onTabChange(isRosteringActive ? activeTab : rosteringTabs[0].id)}
                    onKeyDown={handleTabKeyDown}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isRosteringActive
                        ? "bg-dark-100 text-[#FAFAFA] shadow-sm"
                        : "text-dark-600 hover:bg-dark-100/60 hover:text-[#FAFAFA]"
                    }`}
                  >
                    <ShieldCheck className="size-4" />
                    {group.label}
                  </button>
                ) : (
                  group.items.map(({ id, label, icon: Icon, disabled }) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={activeTab === id}
                      aria-controls={`settings-tabpanel-${id}`}
                      id={`settings-tab-${id}`}
                      tabIndex={activeTab === id ? 0 : -1}
                      onClick={() => !disabled && onTabChange(id)}
                      onKeyDown={!disabled ? handleTabKeyDown : undefined}
                      disabled={disabled}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        activeTab === id
                          ? "bg-dark-100 text-[#FAFAFA] shadow-sm"
                          : disabled
                            ? "text-dark-500 cursor-not-allowed"
                            : "text-dark-600 hover:bg-dark-100/60 hover:text-[#FAFAFA]"
                      }`}
                    >
                      <Icon className="size-4" />
                      {label}
                      {disabled && (
                        <span className="ml-auto text-[10px] text-dark-500 uppercase">
                          Soon
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Content area */}
      <div
        role="tabpanel"
        id={`settings-tabpanel-${activeTab}`}
        aria-labelledby={
          isRosteringActive ? `settings-tab-${ROSTERING_GROUP_ID}` : `settings-tab-${activeTab}`
        }
        className="flex-1 overflow-y-auto bg-dark"
      >
        {isRosteringActive && (
          <div
            role="tablist"
            aria-label={GROUP_ORDER.find((g) => g.id === "rosteringCompliance")?.label}
            className="flex gap-1 p-1 mx-6 mt-6 rounded-xl bg-dark-50 border border-dark-200 w-fit"
          >
            {rosteringTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={activeTab === id}
                aria-controls={`settings-tabpanel-${id}`}
                id={`settings-tab-${id}`}
                onClick={() => onTabChange(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === id
                    ? "bg-dark-100 text-white shadow-[0_0_8px_rgba(212,165,116,0.1)]"
                    : "text-dark-600 hover:text-white hover:bg-dark-100/50"
                }`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

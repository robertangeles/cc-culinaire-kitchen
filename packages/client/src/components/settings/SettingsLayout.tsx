/**
 * @module SettingsLayout
 *
 * Two-column layout for the Settings page. Renders a vertical tab bar on the
 * left and a scrollable content area on the right. Tabs that are not yet
 * implemented are shown in a disabled state with a "Soon" badge.
 *
 * Tabs are organised into groups (Web / Mobile / Shared / Unassigned) so an
 * admin can see, at a glance, which app each setting affects. Group placement
 * is driven by the optional `group` field on each tab — empty groups are not
 * rendered, and tabs without a group fall through to "Unassigned".
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
  Plug,
  MessagesSquare,
  FileText,
  type LucideIcon,
} from "lucide-react";

/** Which app surface a settings tab primarily affects. */
export type SettingsGroup = "web" | "mobile" | "shared" | "unassigned";

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
}

/** Display order + label for each group section. */
const GROUP_ORDER: { id: SettingsGroup; label: string }[] = [
  { id: "web", label: "Web" },
  { id: "mobile", label: "Mobile" },
  { id: "shared", label: "Shared" },
  { id: "unassigned", label: "Unassigned" },
];

/** Registry of all settings tabs. Disabled tabs are planned future features. */
const tabs: TabItem[] = [
  { id: "prompts", label: "Prompts", icon: ScrollText, group: "shared" },
  { id: "mobilePrompts", label: "Prompts", icon: ScrollText, group: "mobile" },
  { id: "mobilePages", label: "Pages", icon: FileText, group: "mobile" },
  { id: "siteSettings", label: "Site Settings", icon: Globe, group: "web" },
  { id: "pages", label: "Pages", icon: FileText, group: "web" },
  { id: "appearance", label: "Appearance", icon: Palette, group: "web" },
  { id: "users", label: "Users", icon: Users, group: "shared" },
  { id: "roles", label: "Roles", icon: Shield, group: "shared" },
  { id: "integrations", label: "Integrations", icon: Plug, group: "shared" },
  { id: "models", label: "Models", icon: Bot, disabled: true, group: "shared" },
  { id: "knowledge", label: "Knowledge Base", icon: BookOpen, group: "shared" },
  { id: "bench", label: "The Bench", icon: MessagesSquare, group: "web" },
  { id: "userGuide", label: "User Guide", icon: BookOpen, group: "web" },
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
  const visualTabs = orderedTabs(tabs);
  const enabledTabs = visualTabs.filter((t) => !t.disabled);
  // Always render the three primary groups (Web, Mobile, Shared) so the
  // cherry-pick targets stay visible even when empty. The Unassigned fallback
  // only renders when something falls into it.
  const groups = groupTabs(tabs).filter(
    (g) => g.id !== "unassigned" || g.items.length > 0,
  );

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const currentIndex = enabledTabs.findIndex((t) => t.id === activeTab);
    const next =
      e.key === "ArrowDown"
        ? (currentIndex + 1) % enabledTabs.length
        : (currentIndex - 1 + enabledTabs.length) % enabledTabs.length;
    const nextId = enabledTabs[next].id;
    onTabChange(nextId);
    document.getElementById(`settings-tab-${nextId}`)?.focus();
  }

  return (
    <div className="flex h-full bg-[#0A0A0A]">
      {/* Tab navigation */}
      <div className="w-56 border-r border-[#2A2A2A] bg-[#0A0A0A] px-3 py-6">
        <h2 className="px-3 mb-4 text-sm font-semibold text-[#666666] uppercase tracking-wider">
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
              <h3 className="px-3 mb-2 text-xs font-semibold text-[#666666] uppercase tracking-wider">
                {group.label}
              </h3>
              {group.items.length === 0 && (
                <p className="px-3 py-2 text-xs italic text-[#555555]">
                  No tabs yet
                </p>
              )}
              <div className="space-y-1">
                {group.items.map(({ id, label, icon: Icon, disabled }) => (
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
                        ? "bg-[#1E1E1E] text-[#FAFAFA] shadow-sm"
                        : disabled
                          ? "text-[#666666] cursor-not-allowed"
                          : "text-[#999999] hover:bg-[#1E1E1E]/60 hover:text-[#FAFAFA]"
                    }`}
                  >
                    <Icon className="size-4" />
                    {label}
                    {disabled && (
                      <span className="ml-auto text-[10px] text-[#666666] uppercase">
                        Soon
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Content area */}
      <div
        role="tabpanel"
        id={`settings-tabpanel-${activeTab}`}
        aria-labelledby={`settings-tab-${activeTab}`}
        className="flex-1 overflow-y-auto bg-[#0A0A0A]"
      >
        {children}
      </div>
    </div>
  );
}

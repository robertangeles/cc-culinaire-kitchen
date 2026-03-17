/**
 * @module SettingsLayout
 *
 * Two-column layout for the Settings page. Renders a vertical tab bar on the
 * left and a scrollable content area on the right. Tabs that are not yet
 * implemented are shown in a disabled state with a "Soon" badge.
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
  type LucideIcon,
} from "lucide-react";

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
}

/** Registry of all settings tabs. Disabled tabs are planned future features. */
const tabs: TabItem[] = [
  { id: "prompts", label: "Prompts", icon: ScrollText },
  { id: "siteSettings", label: "Site Settings", icon: Globe },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "users", label: "Users", icon: Users },
  { id: "roles", label: "Roles", icon: Shield },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "models", label: "Models", icon: Bot, disabled: true },
  { id: "knowledge", label: "Knowledge Base", icon: BookOpen },
  { id: "bench", label: "The Bench", icon: MessagesSquare },
];

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
  const enabledTabs = tabs.filter((t) => !t.disabled);

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
    <div className="flex h-full">
      {/* Tab navigation */}
      <div className="w-56 border-r border-stone-200 bg-stone-50 px-3 py-6">
        <h2 className="px-3 mb-4 text-sm font-semibold text-stone-500 uppercase tracking-wider">
          Settings
        </h2>
        <nav role="tablist" aria-label="Settings" aria-orientation="vertical" className="space-y-1">
          {tabs.map(({ id, label, icon: Icon, disabled }) => (
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
                  ? "bg-white text-stone-900 shadow-sm"
                  : disabled
                    ? "text-stone-300 cursor-not-allowed"
                    : "text-stone-600 hover:bg-white/60 hover:text-stone-900"
              }`}
            >
              <Icon className="size-4" />
              {label}
              {disabled && (
                <span className="ml-auto text-[10px] text-stone-300 uppercase">
                  Soon
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Content area */}
      <div
        role="tabpanel"
        id={`settings-tabpanel-${activeTab}`}
        aria-labelledby={`settings-tab-${activeTab}`}
        className="flex-1 overflow-y-auto"
      >
        {children}
      </div>
    </div>
  );
}

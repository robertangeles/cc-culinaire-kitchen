/**
 * @module SettingsPage
 *
 * Top-level page for application settings. Manages tab selection state and
 * delegates layout to {@link SettingsLayout}, rendering the appropriate
 * content panel for the active tab.
 */

import { useState } from "react";
import { SettingsLayout } from "../components/settings/SettingsLayout.js";
import { PromptsTab } from "../components/settings/PromptsTab.js";
import { SiteSettingsTab } from "../components/settings/SiteSettingsTab.js";
import { AppearanceTab } from "../components/settings/AppearanceTab.js";
import { UsersTab } from "../components/settings/UsersTab.js";
import { RolesTab } from "../components/settings/RolesTab.js";
import { IntegrationsTab } from "../components/settings/IntegrationsTab.js";
import KnowledgeBaseTab from "../components/settings/KnowledgeBaseTab.js";

/**
 * Page component mounted at `/settings`. Defaults to the "prompts" tab
 * and conditionally renders additional tab panels as they become available.
 */
export function SettingsPage() {
  const [activeTab, setActiveTab] = useState("prompts");

  return (
    <SettingsLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === "prompts" && <PromptsTab />}
      {activeTab === "siteSettings" && <SiteSettingsTab />}
      {activeTab === "appearance" && <AppearanceTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "roles" && <RolesTab />}
      {activeTab === "integrations" && <IntegrationsTab />}
      {activeTab === "knowledge" && <KnowledgeBaseTab />}
    </SettingsLayout>
  );
}

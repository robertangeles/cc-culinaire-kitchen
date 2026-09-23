/**
 * @module SettingsPage
 *
 * Top-level page for application settings. Manages tab selection state and
 * delegates layout to {@link SettingsLayout}, rendering the appropriate
 * content panel for the active tab.
 */

import { useState } from "react";
import { useSearchParams } from "react-router";
import { SettingsLayout } from "../components/settings/SettingsLayout.js";
import { PromptsTab } from "../components/settings/PromptsTab.js";
import { SiteSettingsTab } from "../components/settings/SiteSettingsTab.js";
import { PagesTab } from "../components/settings/PagesTab.js";
import { AppearanceTab } from "../components/settings/AppearanceTab.js";
import { UsersTab } from "../components/settings/UsersTab.js";
import { RequiredDocumentsTab } from "../components/compliance/RequiredDocumentsTab.js";
import { PublicHolidaysTab } from "../components/roster/PublicHolidaysTab.js";
import { AwardRulesTab } from "../components/settings/AwardRulesTab.js";
import { ComplianceRulesTab } from "../components/settings/ComplianceRulesTab.js";
import { RolesTab } from "../components/settings/RolesTab.js";
import { IntegrationsTab } from "../components/settings/IntegrationsTab.js";
import KnowledgeBaseTab from "../components/settings/KnowledgeBaseTab.js";
import { TheBenchTab } from "../components/settings/TheBenchTab.js";
import { UserGuideTab } from "../components/settings/UserGuideTab.js";
import { BrainTab } from "../components/settings/BrainTab.js";
import { useAuth } from "../context/AuthContext.js";

/**
 * Page component mounted at `/settings`. Defaults to the "prompts" tab
 * and conditionally renders additional tab panels as they become available.
 */
export function SettingsPage() {
  // Deep-link support (?tab=awardRules): read once on mount as the initial
  // tab — falls back to "prompts" like before when absent. Added for
  // PublishPanel's "Add rules now" link; no existing settings tab had a
  // way to be linked to directly before this.
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => searchParams.get("tab") ?? "prompts");
  // /settings is a single AuthenticatedOnly route with tab selection as
  // internal state, not per-tab routes (checked App.tsx) — so there is no
  // "direct navigation to a gated route" to redirect away from. Instead,
  // the CONTENT render is gated the same way tab visibility is, so a
  // non-Administrator can never render these panels even via a contrived
  // activeTab state, not just "the tab button is hidden."
  const { user } = useAuth();
  const isAdministrator = user?.roles?.includes("Administrator") ?? false;

  return (
    <SettingsLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === "prompts" && <PromptsTab />}
      {activeTab === "siteSettings" && <SiteSettingsTab />}
      {activeTab === "pages" && <PagesTab surface="web" />}
      {activeTab === "mobilePages" && <PagesTab surface="mobile" />}
      {activeTab === "appearance" && <AppearanceTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "compliance" && <RequiredDocumentsTab />}
      {activeTab === "publicHolidays" && <PublicHolidaysTab />}
      {activeTab === "awardRules" && isAdministrator && <AwardRulesTab />}
      {activeTab === "documentExpiryRules" && isAdministrator && <ComplianceRulesTab />}
      {activeTab === "roles" && <RolesTab />}
      {activeTab === "integrations" && <IntegrationsTab />}
      {activeTab === "knowledge" && <KnowledgeBaseTab />}
      {activeTab === "bench" && <TheBenchTab />}
      {activeTab === "userGuide" && <UserGuideTab />}
      {activeTab === "brain" && <BrainTab />}
    </SettingsLayout>
  );
}

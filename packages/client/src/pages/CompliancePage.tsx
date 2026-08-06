/**
 * @module pages/CompliancePage
 *
 * Page shell for the Compliance Vault operator dashboard, mounted at
 * `/compliance` (see navConfig.ts). All the dashboard logic lives in
 * ComplianceDashboard — this file is just the header and container, matching
 * the other single-view pages (WasteIntelligencePage, PurchasingPage).
 */

import { ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext.js";
import { ComplianceDashboard } from "../components/compliance/ComplianceDashboard.js";

export function CompliancePage() {
  const { user, isGuest } = useAuth();

  if (isGuest || !user) {
    return (
      <div className="flex flex-1 items-center justify-center bg-dark">
        <div className="max-w-md px-6 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-dark-100">
            <ShieldCheck className="size-8 text-gold" aria-hidden="true" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-[#FAFAFA]">Compliance</h2>
          <p className="text-sm text-dark-600">Sign in to view staff compliance status.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-dark">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-r from-gold to-gold-hover shadow-[0_0_12px_rgba(212,165,116,0.2)]">
            <ShieldCheck className="size-5 text-dark" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-[#FAFAFA]">Compliance</h1>
        </header>

        <ComplianceDashboard />
      </div>
    </div>
  );
}

export default CompliancePage;

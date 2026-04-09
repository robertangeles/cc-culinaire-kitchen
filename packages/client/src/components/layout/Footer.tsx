/**
 * @module Footer
 *
 * Application-wide footer rendered below the main content area.
 * Displays the `footer_text` from site settings, center-justified.
 * Hidden when no footer text has been configured.
 */

import { useLocation } from "react-router";
import { useSettings } from "../../context/SettingsContext.js";

const OPS_ROUTES = ["/inventory", "/menu-intelligence", "/kitchen-copilot", "/waste-intelligence"];

/**
 * Renders a centered footer bar with text from site settings.
 * Returns null if no footer text is configured.
 * Hidden on Kitchen Operations pages (toolbar replaces it).
 */
export function Footer() {
  const { settings } = useSettings();
  const { pathname } = useLocation();
  const footerText = settings.footer_text;

  if (!footerText) return null;
  if (OPS_ROUTES.some((r) => pathname.startsWith(r))) return null;

  return (
    <footer className="border-t border-[#2A2A2A] bg-[#0A0A0A] px-4 py-3 text-center text-xs text-[#999999]">
      {footerText}
    </footer>
  );
}

/**
 * @module Footer
 *
 * Application-wide footer rendered below the main content area.
 * Displays the `footer_text` from site settings, center-justified.
 * Hidden when no footer text has been configured.
 */

import { useSettings } from "../../context/SettingsContext.js";

/**
 * Renders a centered footer bar with text from site settings.
 * Returns null if no footer text is configured.
 */
export function Footer() {
  const { settings } = useSettings();
  const footerText = settings.footer_text;

  if (!footerText) return null;

  return (
    <footer className="border-t border-stone-200 bg-stone-50 px-4 py-3 text-center text-xs text-stone-400">
      {footerText}
    </footer>
  );
}

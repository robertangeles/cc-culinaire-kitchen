/**
 * @module services/featureFlagsService
 *
 * Resolves the mobile feature-flag payload returned by
 * `GET /api/mobile/feature-flags`. The shape is intentionally
 * forward-compatible: today it carries `languages_enabled`, but the
 * mobile session may extend it later with a `features` map (voice input,
 * image input, etc.) without breaking older clients.
 *
 * `languages_enabled` is sourced from the `mobile_languages_enabled`
 * site setting (JSON-encoded string array). On parse failure or missing
 * row the resolver falls back to `["en"]` so the mobile picker always has
 * at least the default locale to surface.
 */

import { getAllSettings } from "./settingsService.js";

/** Shape of the mobile feature-flags response. Stable contract for mobile. */
export interface MobileFeatureFlags {
  languages_enabled: string[];
}

/** Conservative fallback when the setting is missing or malformed. */
const DEFAULT_LANGUAGES = ["en"];

/**
 * Resolve the live mobile feature-flag set.
 *
 * Reads `mobile_languages_enabled` from `site_setting` (with the default
 * applied by {@link getAllSettings} so a brand-new DB still returns a
 * usable payload). Validates the value is a non-empty array of short
 * lowercase locale strings; falls back to `["en"]` on any parse or
 * shape failure rather than 500ing — the mobile client must always
 * receive a usable feature flag set.
 */
export async function getMobileFeatureFlags(): Promise<MobileFeatureFlags> {
  const settings = await getAllSettings();
  const raw = settings.mobile_languages_enabled;
  return { languages_enabled: parseLanguagesEnabled(raw) };
}

/** Parse + validate the JSON-encoded array. Returns the safe fallback on any failure. */
function parseLanguagesEnabled(raw: string | undefined): string[] {
  if (!raw) return DEFAULT_LANGUAGES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_LANGUAGES;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_LANGUAGES;
  const cleaned = parsed.filter(
    (v): v is string => typeof v === "string" && /^[a-z]{2,8}$/.test(v),
  );
  return cleaned.length > 0 ? cleaned : DEFAULT_LANGUAGES;
}

export const __test = { parseLanguagesEnabled, DEFAULT_LANGUAGES };

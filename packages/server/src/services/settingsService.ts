/**
 * @module settingsService
 *
 * Service layer for managing application-wide site settings stored
 * as key-value pairs in the `site_setting` table.
 *
 * Provides an in-memory cache that is populated on first access and
 * invalidated whenever settings are updated, keeping hot-path reads
 * (e.g. page meta injection) fast.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { siteSetting } from "../db/schema.js";

/** In-memory cache: setting_key → setting_value. */
let cache: Map<string, string> | null = null;

/**
 * Sensible defaults for settings that should have values even before
 * an admin visits the Site Settings page.  Any key listed here will
 * be returned by {@link getAllSettings} when it is absent from the DB.
 */
const SETTING_DEFAULTS: Record<string, string> = {
  web_search_enabled: "true",
  web_search_model: "perplexity/sonar-pro",
  image_generation_enabled: "true",
  image_generation_model: "google/gemini-2.5-flash-image",
  guest_session_idle_hours: "24",
  // Vector search is off by default; enable after confirming pgvector extension
  // is installed on the PostgreSQL instance and OPENROUTER_API_KEY is configured.
  vector_search_enabled: "false",
  // i18n v1.2: which languages the mobile picker may surface. Stored as a
  // JSON-encoded string array so the existing varchar settingValue column
  // doesn't need a schema change. Default `["en"]` until each new locale
  // has an authored prompt slug, reviewer signoff, and an eval pass per
  // shared-context/mobile-needs.md.
  mobile_languages_enabled: '["en"]',
  // Lowest phone app version allowed to sign in or download a count. 0.0.0 blocks nobody.
  mobile_min_app_version: "0.0.0",
  // Where the phone's "update the app" button goes. Empty until the store listings exist.
  mobile_store_url_ios: "",
  mobile_store_url_android: "",
};

/**
 * Retrieve all site settings as a key-value map.
 *
 * Uses the in-memory cache when available; falls back to a DB query
 * and populates the cache on first call.  Missing keys that have
 * entries in {@link SETTING_DEFAULTS} are filled with their defaults.
 *
 * @returns A plain object mapping setting keys to their values.
 */
export async function getAllSettings(): Promise<Record<string, string>> {
  if (cache) return Object.fromEntries(cache);

  const rows = await db.select().from(siteSetting);
  cache = new Map(rows.map((r) => [r.settingKey, r.settingValue]));

  // Fill in defaults for keys that aren't stored yet
  for (const [key, val] of Object.entries(SETTING_DEFAULTS)) {
    if (!cache.has(key)) cache.set(key, val);
  }

  return Object.fromEntries(cache);
}

/**
 * Upsert one or more settings and invalidate the cache.
 *
 * For each key-value pair, inserts a new row if the key does not exist
 * or updates the existing row's value and `updated_dttm`.
 *
 * @param settings - Object mapping setting keys to new values.
 */
export async function upsertSettings(
  settings: Record<string, string>
): Promise<void> {
  for (const [key, value] of Object.entries(settings)) {
    const existing = await db
      .select({ settingId: siteSetting.settingId })
      .from(siteSetting)
      .where(eq(siteSetting.settingKey, key));

    if (existing.length > 0) {
      await db
        .update(siteSetting)
        .set({ settingValue: value, updatedDttm: new Date() })
        .where(eq(siteSetting.settingId, existing[0].settingId));
    } else {
      await db.insert(siteSetting).values({
        settingKey: key,
        settingValue: value,
      });
    }
  }

  // Invalidate cache so next read picks up changes
  cache = null;
}

/**
 * Check a settings update before it is saved.
 *
 * @param updates - key-value pairs about to be upserted.
 * @returns A plain sentence for the first problem found, or null when the update is acceptable.
 */
export function validateSettingsUpdate(updates: Record<string, string>): string | null {
  const minVersion = updates.mobile_min_app_version;
  if (minVersion !== undefined && !/^\d+\.\d+\.\d+$/.test(minVersion)) {
    return "The minimum phone app version must look like 1.2.3 (0.0.0 allows every version).";
  }
  for (const key of ["mobile_store_url_ios", "mobile_store_url_android"]) {
    const url = updates[key];
    if (url !== undefined && url !== "" && !/^https:\/\/\S+$/.test(url)) {
      return "A store link must be a web address starting with https:// (leave it empty until the listing exists).";
    }
  }
  return null;
}


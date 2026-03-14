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
  image_generation_enabled: "true",
  image_generation_model: "gemini-2.0-flash-exp-image-generation",
  guest_session_idle_hours: "24",
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

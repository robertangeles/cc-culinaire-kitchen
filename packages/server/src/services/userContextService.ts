/**
 * @module userContextService
 *
 * Service for managing user kitchen profiles (personalization layer).
 *
 * Each authenticated user can have a `kitchen_profile` row that stores
 * their skill level, cuisine preferences, dietary restrictions, and
 * available equipment. This profile is injected as context text into
 * every AI chat request and recipe generation call so that responses are
 * personalised to the individual user.
 *
 * The `buildContextString()` function returns a compact Markdown block
 * that is prepended to the AI system prompt at request time.
 *
 * Data classified as health data (dietary restrictions) follows the same
 * PII handling principles used for user addresses: stored plaintext in DB
 * (not encrypted) for now — no free-text fields, only pre-defined enum
 * values, so exposure risk is low.
 */

import { eq } from "drizzle-orm";
import pino from "pino";
import { db } from "../db/index.js";
import { kitchenProfile } from "../db/schema.js";

const logger = pino({ name: "userContextService" });

/** The shape of a kitchen profile returned to callers. */
export interface KitchenProfile {
  kitchenProfileId: number;
  userId: number;
  skillLevel: string;
  cuisinePreferences: string[];
  dietaryRestrictions: string[];
  kitchenEquipment: string[];
  servingsDefault: number;
  onboardingDoneInd: boolean;
}

/**
 * Default profile values returned when a user has no profile row yet.
 * Using defaults (rather than null) means callers never need to null-check.
 */
const DEFAULT_PROFILE: Omit<KitchenProfile, "kitchenProfileId" | "userId"> = {
  skillLevel: "home_cook",
  cuisinePreferences: [],
  dietaryRestrictions: [],
  kitchenEquipment: [],
  servingsDefault: 4,
  onboardingDoneInd: false,
};

/**
 * Retrieve the kitchen profile for a user, returning defaults when none exists.
 *
 * @param userId - The authenticated user's ID.
 * @returns The kitchen profile, or defaults if the user has not set one yet.
 */
export async function getProfile(userId: number): Promise<KitchenProfile> {
  const rows = await db
    .select()
    .from(kitchenProfile)
    .where(eq(kitchenProfile.userId, userId));

  if (rows.length === 0) {
    logger.debug({ userId }, "getProfile: no profile found, returning defaults");
    return { kitchenProfileId: 0, userId, ...DEFAULT_PROFILE };
  }

  const row = rows[0];
  return {
    kitchenProfileId: row.kitchenProfileId,
    userId: row.userId,
    skillLevel: row.skillLevel,
    cuisinePreferences: (row.cuisinePreferences as string[]) ?? [],
    dietaryRestrictions: (row.dietaryRestrictions as string[]) ?? [],
    kitchenEquipment: (row.kitchenEquipment as string[]) ?? [],
    servingsDefault: row.servingsDefault,
    onboardingDoneInd: row.onboardingDoneInd,
  };
}

/**
 * Upsert a kitchen profile for a user (create on first save, update thereafter).
 *
 * @param userId  - The authenticated user's ID.
 * @param updates - Partial profile fields to save.
 * @returns The saved profile.
 */
export async function upsertProfile(
  userId: number,
  updates: Partial<Omit<KitchenProfile, "kitchenProfileId" | "userId">>
): Promise<KitchenProfile> {
  const existing = await db
    .select({ id: kitchenProfile.kitchenProfileId })
    .from(kitchenProfile)
    .where(eq(kitchenProfile.userId, userId));

  const now = new Date();

  if (existing.length === 0) {
    // First save — insert with defaults merged
    await db.insert(kitchenProfile).values({
      userId,
      skillLevel: updates.skillLevel ?? DEFAULT_PROFILE.skillLevel,
      cuisinePreferences: (updates.cuisinePreferences ?? DEFAULT_PROFILE.cuisinePreferences) as string[],
      dietaryRestrictions: (updates.dietaryRestrictions ?? DEFAULT_PROFILE.dietaryRestrictions) as string[],
      kitchenEquipment: (updates.kitchenEquipment ?? DEFAULT_PROFILE.kitchenEquipment) as string[],
      servingsDefault: updates.servingsDefault ?? DEFAULT_PROFILE.servingsDefault,
      onboardingDoneInd: updates.onboardingDoneInd ?? DEFAULT_PROFILE.onboardingDoneInd,
      updatedDttm: now,
    });
    logger.debug({ userId }, "upsertProfile: profile created");
  } else {
    // Subsequent save — update only provided fields
    const setValues: Record<string, unknown> = { updatedDttm: now };
    if (updates.skillLevel !== undefined) setValues.skillLevel = updates.skillLevel;
    if (updates.cuisinePreferences !== undefined) setValues.cuisinePreferences = updates.cuisinePreferences;
    if (updates.dietaryRestrictions !== undefined) setValues.dietaryRestrictions = updates.dietaryRestrictions;
    if (updates.kitchenEquipment !== undefined) setValues.kitchenEquipment = updates.kitchenEquipment;
    if (updates.servingsDefault !== undefined) setValues.servingsDefault = updates.servingsDefault;
    if (updates.onboardingDoneInd !== undefined) setValues.onboardingDoneInd = updates.onboardingDoneInd;

    await db
      .update(kitchenProfile)
      .set(setValues)
      .where(eq(kitchenProfile.userId, userId));
    logger.debug({ userId }, "upsertProfile: profile updated");
  }

  return getProfile(userId);
}

/**
 * Build a compact context string from a kitchen profile for injection into
 * the AI system prompt. Returns an empty string for guest users (userId 0).
 *
 * The format is intentionally terse to avoid consuming too many tokens:
 * ```
 * ## My Kitchen Context
 * - Skill level: sous_chef
 * - Cuisine preferences: French Classical, Japanese
 * - Dietary restrictions: gluten-free
 * - Equipment: combi oven, stand mixer, immersion circulator
 * - Default servings: 4
 * ```
 *
 * @param userId - The authenticated user's ID (0 = guest, no context injected).
 * @returns A Markdown string to prepend to the system prompt, or "".
 */
export async function buildContextString(userId: number): Promise<string> {
  if (!userId || userId <= 0) return "";

  let profile: KitchenProfile;
  try {
    profile = await getProfile(userId);
  } catch (err) {
    logger.error({ userId, err }, "buildContextString: failed to load profile — skipping context");
    return "";
  }

  // A completely blank profile adds no useful context
  const hasContent =
    profile.skillLevel !== "home_cook" ||
    profile.cuisinePreferences.length > 0 ||
    profile.dietaryRestrictions.length > 0 ||
    profile.kitchenEquipment.length > 0;

  if (!hasContent) return "";

  const lines: string[] = ["## My Kitchen Context"];
  lines.push(`- Skill level: ${formatSkillLevel(profile.skillLevel)}`);

  if (profile.cuisinePreferences.length > 0) {
    lines.push(`- Cuisine preferences: ${profile.cuisinePreferences.join(", ")}`);
  }
  if (profile.dietaryRestrictions.length > 0) {
    lines.push(`- Always respect dietary restrictions: **${profile.dietaryRestrictions.join(", ")}**`);
  }
  if (profile.kitchenEquipment.length > 0) {
    lines.push(`- Available equipment: ${profile.kitchenEquipment.join(", ")}`);
  }
  lines.push(`- Default servings: ${profile.servingsDefault}`);

  return lines.join("\n");
}

/** Convert skill_level enum values to human-readable labels. */
function formatSkillLevel(level: string): string {
  const map: Record<string, string> = {
    home_cook: "Home Cook",
    culinary_student: "Culinary Student",
    line_cook: "Line Cook",
    sous_chef: "Sous Chef",
    head_chef: "Head Chef / Executive Chef",
  };
  return map[level] ?? level;
}

/**
 * @module userContextService
 *
 * Service for managing user kitchen profiles (personalization layer).
 *
 * Each authenticated user can have a `kitchen_profile` row that stores
 * their skill level, cuisine preferences, dietary restrictions, available
 * equipment, and restaurant/business context. This profile is injected
 * as context text into every AI chat request and recipe generation call
 * so that responses are personalised to the individual user.
 *
 * The `buildContextString()` function returns a compact Markdown block
 * that is prepended to the AI system prompt at request time.
 */

import { eq } from "drizzle-orm";
import pino from "pino";
import { db } from "../db/index.js";
import { kitchenProfile } from "../db/schema.js";
import {
  ESTABLISHMENT_TYPES,
  PRICE_POINTS,
  PLATING_STYLES,
  SOURCING_VALUES,
  KITCHEN_CONSTRAINTS_OPTIONS,
  MENU_NEEDS,
  getOptionLabel,
  getOptionLabels,
} from "@culinaire/shared";

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
  // Restaurant / business profile
  restaurantName: string | null;
  establishmentType: string | null;
  cuisineIdentity: string | null;
  targetDiner: string | null;
  pricePoint: string | null;
  restaurantVoice: string | null;
  sourcingValues: string[];
  platingStyle: string | null;
  kitchenConstraints: string[];
  menuNeeds: string[];
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
  restaurantName: null,
  establishmentType: null,
  cuisineIdentity: null,
  targetDiner: null,
  pricePoint: null,
  restaurantVoice: null,
  sourcingValues: [],
  platingStyle: null,
  kitchenConstraints: [],
  menuNeeds: [],
};

/**
 * Retrieve the kitchen profile for a user, returning defaults when none exists.
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
    restaurantName: row.restaurantName ?? null,
    establishmentType: row.establishmentType ?? null,
    cuisineIdentity: row.cuisineIdentity ?? null,
    targetDiner: row.targetDiner ?? null,
    pricePoint: row.pricePoint ?? null,
    restaurantVoice: row.restaurantVoice ?? null,
    sourcingValues: (row.sourcingValues as string[]) ?? [],
    platingStyle: row.platingStyle ?? null,
    kitchenConstraints: (row.kitchenConstraints as string[]) ?? [],
    menuNeeds: (row.menuNeeds as string[]) ?? [],
  };
}

/**
 * Upsert a kitchen profile for a user (create on first save, update thereafter).
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
      restaurantName: updates.restaurantName ?? null,
      establishmentType: updates.establishmentType ?? null,
      cuisineIdentity: updates.cuisineIdentity ?? null,
      targetDiner: updates.targetDiner ?? null,
      pricePoint: updates.pricePoint ?? null,
      restaurantVoice: updates.restaurantVoice ?? null,
      sourcingValues: (updates.sourcingValues ?? []) as string[],
      platingStyle: updates.platingStyle ?? null,
      kitchenConstraints: (updates.kitchenConstraints ?? []) as string[],
      menuNeeds: (updates.menuNeeds ?? []) as string[],
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
    if (updates.restaurantName !== undefined) setValues.restaurantName = updates.restaurantName;
    if (updates.establishmentType !== undefined) setValues.establishmentType = updates.establishmentType;
    if (updates.cuisineIdentity !== undefined) setValues.cuisineIdentity = updates.cuisineIdentity;
    if (updates.targetDiner !== undefined) setValues.targetDiner = updates.targetDiner;
    if (updates.pricePoint !== undefined) setValues.pricePoint = updates.pricePoint;
    if (updates.restaurantVoice !== undefined) setValues.restaurantVoice = updates.restaurantVoice;
    if (updates.sourcingValues !== undefined) setValues.sourcingValues = updates.sourcingValues;
    if (updates.platingStyle !== undefined) setValues.platingStyle = updates.platingStyle;
    if (updates.kitchenConstraints !== undefined) setValues.kitchenConstraints = updates.kitchenConstraints;
    if (updates.menuNeeds !== undefined) setValues.menuNeeds = updates.menuNeeds;

    await db
      .update(kitchenProfile)
      .set(setValues)
      .where(eq(kitchenProfile.userId, userId));
    logger.debug({ userId }, "upsertProfile: profile updated");
  }

  return getProfile(userId);
}

/**
 * Sanitize freeform text before injecting into AI prompts.
 * Strips markdown headers, code fences, and instruction-like patterns
 * to mitigate prompt injection from profile fields.
 */
function sanitizeForPrompt(text: string | null): string {
  if (!text) return "";
  return text
    .replace(/^#{1,6}\s/gm, "")       // Strip markdown headers
    .replace(/```[\s\S]*?```/g, "")    // Strip code fences
    .replace(/SYSTEM:|INSTRUCTION:|ASSISTANT:|USER:/gi, "")
    .trim();
}

/**
 * Build a compact context string from a kitchen profile for injection into
 * the AI system prompt. Returns an empty string for guest users (userId 0).
 *
 * The format is intentionally terse to avoid consuming too many tokens.
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

  const lines: string[] = [];

  // ── My Kitchen Context ──────────────────────────────────
  const hasKitchenContent =
    profile.skillLevel !== "home_cook" ||
    profile.cuisinePreferences.length > 0 ||
    profile.dietaryRestrictions.length > 0 ||
    profile.kitchenEquipment.length > 0;

  if (hasKitchenContent) {
    lines.push("## My Kitchen Context");
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
  }

  // ── Restaurant Context ──────────────────────────────────
  const hasRestaurantContent =
    profile.restaurantName ||
    profile.establishmentType ||
    profile.cuisineIdentity ||
    profile.targetDiner ||
    profile.pricePoint ||
    profile.restaurantVoice ||
    profile.sourcingValues.length > 0 ||
    profile.platingStyle ||
    profile.kitchenConstraints.length > 0 ||
    profile.menuNeeds.length > 0;

  if (hasRestaurantContent) {
    lines.push("");
    lines.push("## Restaurant Context");

    if (profile.restaurantName) {
      lines.push(`- Restaurant: ${sanitizeForPrompt(profile.restaurantName)}`);
    }
    if (profile.establishmentType) {
      lines.push(`- Establishment: ${getOptionLabel(ESTABLISHMENT_TYPES, profile.establishmentType)}`);
    }
    if (profile.cuisineIdentity) {
      lines.push(`- Cuisine identity: ${sanitizeForPrompt(profile.cuisineIdentity)}`);
    }
    if (profile.targetDiner) {
      lines.push(`- Target diner: ${sanitizeForPrompt(profile.targetDiner)}`);
    }
    if (profile.pricePoint) {
      lines.push(`- Price point: ${getOptionLabel(PRICE_POINTS, profile.pricePoint)}`);
    }
    if (profile.restaurantVoice) {
      lines.push(`- Restaurant voice: ${sanitizeForPrompt(profile.restaurantVoice)}`);
    }
    if (profile.sourcingValues.length > 0) {
      lines.push(`- Sourcing values: ${getOptionLabels(SOURCING_VALUES, profile.sourcingValues).join(", ")}`);
    }
    if (profile.platingStyle) {
      lines.push(`- Plating style: ${getOptionLabel(PLATING_STYLES, profile.platingStyle)}`);
    }
    if (profile.kitchenConstraints.length > 0) {
      lines.push(`- Kitchen constraints: ${getOptionLabels(KITCHEN_CONSTRAINTS_OPTIONS, profile.kitchenConstraints).join(", ")}`);
    }
    if (profile.menuNeeds.length > 0) {
      lines.push(`- Menu priorities: ${getOptionLabels(MENU_NEEDS, profile.menuNeeds).join(", ")}`);
    }
  }

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
    restaurant_owner: "Restaurant Owner / Restaurateur",
  };
  return map[level] ?? level;
}

/**
 * @module services/personalisationOptionsService
 *
 * CRUD operations for kitchen_profile_option — the admin-managed set of
 * selectable options for skill levels, cuisine preferences, dietary
 * restrictions, and kitchen equipment.
 */

import { db } from "../db/index.js";
import { kitchenProfileOption } from "../db/schema.js";
import { eq, and, asc } from "drizzle-orm";

export type OptionType = "skill_level" | "cuisine" | "dietary" | "equipment";

export interface ProfileOption {
  optionId: number;
  optionType: string;
  optionValue: string;
  optionLabel: string;
  optionDescription: string | null;
  sortOrder: number;
  activeInd: boolean;
}

export interface GroupedOptions {
  skill_level: ProfileOption[];
  cuisine: ProfileOption[];
  dietary: ProfileOption[];
  equipment: ProfileOption[];
}

/**
 * Returns all active options grouped by type.
 * Used by the KitchenWizard and MyKitchenTab for user-facing selection.
 */
export async function getActiveOptions(): Promise<GroupedOptions> {
  const rows = await db
    .select()
    .from(kitchenProfileOption)
    .where(eq(kitchenProfileOption.activeInd, true))
    .orderBy(asc(kitchenProfileOption.optionType), asc(kitchenProfileOption.sortOrder));

  const grouped: GroupedOptions = {
    skill_level: [],
    cuisine: [],
    dietary: [],
    equipment: [],
  };

  for (const row of rows) {
    const type = row.optionType as OptionType;
    if (grouped[type]) {
      grouped[type].push(row as ProfileOption);
    }
  }

  return grouped;
}

/**
 * Returns ALL options (including inactive) for the admin Personalisation tab.
 */
export async function getAllOptions(): Promise<GroupedOptions> {
  const rows = await db
    .select()
    .from(kitchenProfileOption)
    .orderBy(asc(kitchenProfileOption.optionType), asc(kitchenProfileOption.sortOrder));

  const grouped: GroupedOptions = {
    skill_level: [],
    cuisine: [],
    dietary: [],
    equipment: [],
  };

  for (const row of rows) {
    const type = row.optionType as OptionType;
    if (grouped[type]) {
      grouped[type].push(row as ProfileOption);
    }
  }

  return grouped;
}

/**
 * Creates a new personalisation option.
 */
export async function createOption(data: {
  optionType: OptionType;
  optionValue: string;
  optionLabel: string;
  optionDescription?: string;
  sortOrder?: number;
}): Promise<ProfileOption> {
  const [row] = await db
    .insert(kitchenProfileOption)
    .values({
      optionType: data.optionType,
      optionValue: data.optionValue,
      optionLabel: data.optionLabel,
      optionDescription: data.optionDescription ?? null,
      sortOrder: data.sortOrder ?? 0,
      activeInd: true,
    })
    .returning();

  return row as ProfileOption;
}

/**
 * Partially updates an existing option (label, description, sortOrder, activeInd).
 */
export async function updateOption(
  optionId: number,
  data: Partial<{
    optionLabel: string;
    optionDescription: string | null;
    sortOrder: number;
    activeInd: boolean;
  }>
): Promise<ProfileOption | null> {
  const [row] = await db
    .update(kitchenProfileOption)
    .set({ ...data, updatedDttm: new Date() })
    .where(eq(kitchenProfileOption.optionId, optionId))
    .returning();

  return (row as ProfileOption) ?? null;
}

/**
 * Hard-deletes an option. Existing user profiles that stored the value
 * are unaffected (values are stored as free text in kitchen_profile).
 */
export async function deleteOption(optionId: number): Promise<boolean> {
  const result = await db
    .delete(kitchenProfileOption)
    .where(eq(kitchenProfileOption.optionId, optionId))
    .returning({ optionId: kitchenProfileOption.optionId });

  return result.length > 0;
}

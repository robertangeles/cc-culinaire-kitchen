/**
 * The kitchen profile form: what the server stores, turned into what the screen edits and back. The same rules as the web's
 * `MyKitchenTab.tsx`: an establishment type or sourcing value that is not in the fixed list is the person's own "Other" text.
 */

import type { KitchenProfile } from "@culinaire/shared/schemas/account";
import { ESTABLISHMENT_TYPES, SOURCING_VALUES } from "@culinaire/shared";

export interface KitchenForm {
  skillLevel: string;
  cuisinePreferences: string[];
  dietaryRestrictions: string[];
  kitchenEquipment: string[];
  servingsDefault: string;
  kitchenConstraints: string[];
  restaurantName: string;
  establishmentType: string;
  establishmentTypeOther: string;
  cuisineIdentity: string;
  targetDiner: string;
  pricePoint: string;
  restaurantVoice: string;
  sourcingValues: string[];
  sourcingOther: string;
  platingStyle: string;
  menuNeeds: string[];
}

const KNOWN_ESTABLISHMENTS = ESTABLISHMENT_TYPES.map((o) => o.value);
const KNOWN_SOURCING = SOURCING_VALUES.map((o) => o.value);

export function toForm(p: KitchenProfile): KitchenForm {
  const otherEstablishment = p.establishmentType !== "" && !KNOWN_ESTABLISHMENTS.includes(p.establishmentType);
  return {
    skillLevel: p.skillLevel,
    cuisinePreferences: p.cuisinePreferences,
    dietaryRestrictions: p.dietaryRestrictions,
    kitchenEquipment: p.kitchenEquipment,
    servingsDefault: String(p.servingsDefault),
    kitchenConstraints: p.kitchenConstraints,
    restaurantName: p.restaurantName,
    establishmentType: otherEstablishment ? "other" : p.establishmentType,
    establishmentTypeOther: otherEstablishment ? p.establishmentType : "",
    cuisineIdentity: p.cuisineIdentity,
    targetDiner: p.targetDiner,
    pricePoint: p.pricePoint,
    restaurantVoice: p.restaurantVoice,
    sourcingValues: p.sourcingValues.filter((v) => KNOWN_SOURCING.includes(v)),
    sourcingOther: p.sourcingValues.filter((v) => !KNOWN_SOURCING.includes(v)).join(", "),
    platingStyle: p.platingStyle,
    menuNeeds: p.menuNeeds,
  };
}

/** Default servings as the server takes it (a whole number, 1 to 100), or null for a value it would refuse. */
export function servings(text: string): number | null {
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}

/**
 * What to send (`PUT` is a partial update). Someone who is not an organisation admin edits only their skill level, as on the web,
 * so nothing else is sent and the organisation's answers are never overwritten from their phone.
 */
export function toChanges(f: KitchenForm, isOrgAdmin: boolean): Record<string, unknown> {
  if (!isOrgAdmin) return { skillLevel: f.skillLevel };
  const orNull = (v: string) => v.trim() || null;
  const other = f.sourcingOther.trim();
  return {
    skillLevel: f.skillLevel,
    cuisinePreferences: f.cuisinePreferences,
    dietaryRestrictions: f.dietaryRestrictions,
    kitchenEquipment: f.kitchenEquipment,
    servingsDefault: servings(f.servingsDefault) ?? undefined,
    kitchenConstraints: f.kitchenConstraints,
    restaurantName: orNull(f.restaurantName),
    establishmentType: f.establishmentType === "other" ? orNull(f.establishmentTypeOther) : orNull(f.establishmentType),
    cuisineIdentity: orNull(f.cuisineIdentity),
    targetDiner: orNull(f.targetDiner),
    pricePoint: orNull(f.pricePoint),
    restaurantVoice: orNull(f.restaurantVoice),
    sourcingValues: other ? [...f.sourcingValues, other] : f.sourcingValues,
    platingStyle: orNull(f.platingStyle),
    menuNeeds: f.menuNeeds,
  };
}

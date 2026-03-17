/**
 * @module kitchenProfileConstants
 *
 * Hardcoded option lists for the restaurant / business profile fields.
 * These are stable industry classifications — not admin-managed.
 * Shared between client and server for a single source of truth.
 */

export interface ProfileOption {
  value: string;
  label: string;
}

// ── Establishment Type ──────────────────────────────────────────────

export const ESTABLISHMENT_TYPES: ProfileOption[] = [
  { value: "fine_dining", label: "Fine dining" },
  { value: "casual_dining", label: "Casual dining" },
  { value: "fast_casual", label: "Fast casual" },
  { value: "cafe_bakery", label: "Cafe / Bakery" },
  { value: "catering", label: "Catering" },
  { value: "food_truck", label: "Food truck / Market stall" },
  { value: "pop_up", label: "Pop-up" },
  { value: "ghost_kitchen", label: "Ghost kitchen / Delivery only" },
  { value: "hotel_resort", label: "Hotel / Resort" },
  { value: "institutional", label: "Institutional (hospital, school, aged care)" },
  { value: "other", label: "Other" },
];

// ── Price Point ─────────────────────────────────────────────────────

export const PRICE_POINTS: ProfileOption[] = [
  { value: "budget", label: "Under $15" },
  { value: "mid_range", label: "$15 – $30" },
  { value: "upper_mid", label: "$30 – $50" },
  { value: "premium", label: "$50 – $80" },
  { value: "fine_dining", label: "$80+" },
];

// ── Plating Style ───────────────────────────────────────────────────

export const PLATING_STYLES: ProfileOption[] = [
  { value: "rustic", label: "Rustic / Family style" },
  { value: "structured", label: "Clean and structured" },
  { value: "architectural", label: "Architectural / Fine dining" },
  { value: "bowl_casual", label: "Bowl food / Casual" },
  { value: "minimal", label: "Minimal / Nordic-influenced" },
];

// ── Sourcing Values ─────────────────────────────────────────────────

export const SOURCING_VALUES: ProfileOption[] = [
  { value: "local_regional", label: "Local / Regional sourcing" },
  { value: "organic", label: "Organic" },
  { value: "sustainable_seafood", label: "Sustainable seafood" },
  { value: "free_range", label: "Free range" },
  { value: "nose_to_tail", label: "Nose-to-tail" },
  { value: "root_to_stem", label: "Root-to-stem" },
  { value: "seasonal_only", label: "Seasonal only" },
  { value: "biodynamic", label: "Biodynamic" },
  { value: "indigenous", label: "Indigenous ingredients" },
  { value: "no_preference", label: "No sourcing preference" },
  { value: "other", label: "Other" },
];

// ── Kitchen Constraints ─────────────────────────────────────────────

export const KITCHEN_CONSTRAINTS_OPTIONS: ProfileOption[] = [
  { value: "no_deep_fryer", label: "No deep fryer" },
  { value: "no_charcoal_grill", label: "No charcoal / Wood grill" },
  { value: "no_sous_vide", label: "No sous vide" },
  { value: "no_pasta_machine", label: "No pasta machine" },
  { value: "limited_cold_storage", label: "Limited cold storage" },
  { value: "small_team", label: "Small team (1–3 cooks)" },
  { value: "large_team", label: "Large team (10+)" },
  { value: "restricted_prep_space", label: "Restricted prep space" },
  { value: "no_constraints", label: "No constraints" },
];

// ── Menu Needs (max 3 selections) ───────────────────────────────────

export const MENU_NEEDS: ProfileOption[] = [
  { value: "new_mains", label: "New mains" },
  { value: "new_starters", label: "New starters / Share plates" },
  { value: "new_desserts", label: "New desserts" },
  { value: "new_sides", label: "New sides / Accompaniments" },
  { value: "veg_vegan", label: "Vegetarian / Vegan options" },
  { value: "lower_food_cost", label: "Lower food cost dishes" },
  { value: "high_margin_heroes", label: "High-margin hero dishes" },
  { value: "seasonal_specials", label: "Seasonal specials" },
  { value: "catering_banquet", label: "Catering / Banquet items" },
  { value: "staff_meals", label: "Staff meal ideas" },
];

// ── Helpers ──────────────────────────────────────────────────────────

/** Look up label for a value from any option list. Returns the value itself if not found. */
export function getOptionLabel(options: ProfileOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** Look up labels for multiple values. */
export function getOptionLabels(options: ProfileOption[], values: string[]): string[] {
  return values.map((v) => getOptionLabel(options, v));
}

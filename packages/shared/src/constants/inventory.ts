// ─────────────────────────────────────────────────────────────
// Inventory System — Shared Constants
// Used by both client and server. Single source of truth.
// ─────────────────────────────────────────────────────────────

// ── Item Types ──────────────────────────────────────────────

export const ITEM_TYPES = {
  KITCHEN_INGREDIENT: {
    key: "KITCHEN_INGREDIENT",
    label: "Kitchen Ingredient",
    color: "emerald",
    bgClass: "bg-emerald-500/15",
    textClass: "text-emerald-400",
    borderClass: "border-emerald-500/30",
    glowClass: "shadow-[0_0_10px_rgba(16,185,129,0.15)]",
  },
  FOH_CONSUMABLE: {
    key: "FOH_CONSUMABLE",
    label: "FOH Consumable",
    color: "sky",
    bgClass: "bg-sky-500/15",
    textClass: "text-sky-400",
    borderClass: "border-sky-500/30",
    glowClass: "shadow-[0_0_10px_rgba(14,165,233,0.15)]",
  },
  OPERATIONAL_SUPPLY: {
    key: "OPERATIONAL_SUPPLY",
    label: "Operational Supply",
    color: "amber",
    bgClass: "bg-amber-500/15",
    textClass: "text-amber-400",
    borderClass: "border-amber-500/30",
    glowClass: "shadow-[0_0_10px_rgba(245,158,11,0.15)]",
  },
} as const;

export type ItemTypeKey = keyof typeof ITEM_TYPES;
export const ITEM_TYPE_KEYS = Object.keys(ITEM_TYPES) as ItemTypeKey[];

// ── FIFO Modes ──────────────────────────────────────────────

export const FIFO_MODES = {
  ALWAYS: {
    key: "ALWAYS",
    label: "Always",
    description: "Every delivery creates a dated batch",
  },
  PERISHABLE_ONLY: {
    key: "PERISHABLE_ONLY",
    label: "Perishables Only",
    description: "Only perishable items get batches",
  },
  NEVER: {
    key: "NEVER",
    label: "Never",
    description: "Running total only, no batch tracking",
  },
} as const;

export type FifoModeKey = keyof typeof FIFO_MODES;

/** Default FIFO mode per item type — HQ can override per item */
export const FIFO_DEFAULTS: Record<ItemTypeKey, FifoModeKey> = {
  KITCHEN_INGREDIENT: "ALWAYS",
  FOH_CONSUMABLE: "PERISHABLE_ONLY",
  OPERATIONAL_SUPPLY: "NEVER",
};

// ── Categories ──────────────────────────────────────────────

export interface CategoryDef {
  readonly key: string;
  readonly label: string;
  readonly validTypes: readonly ItemTypeKey[];
}

export const CATEGORIES: readonly CategoryDef[] = [
  { key: "proteins", label: "Proteins", validTypes: ["KITCHEN_INGREDIENT"] },
  { key: "produce", label: "Produce", validTypes: ["KITCHEN_INGREDIENT"] },
  { key: "dairy", label: "Dairy", validTypes: ["KITCHEN_INGREDIENT"] },
  { key: "dry_goods", label: "Dry Goods", validTypes: ["KITCHEN_INGREDIENT"] },
  {
    key: "beverages",
    label: "Beverages",
    validTypes: ["KITCHEN_INGREDIENT", "FOH_CONSUMABLE"],
  },
  { key: "spirits", label: "Spirits", validTypes: ["KITCHEN_INGREDIENT"] },
  { key: "frozen", label: "Frozen", validTypes: ["KITCHEN_INGREDIENT"] },
  { key: "bakery", label: "Bakery", validTypes: ["KITCHEN_INGREDIENT"] },
  { key: "condiments", label: "Condiments", validTypes: ["KITCHEN_INGREDIENT"] },
  { key: "packaging", label: "Packaging", validTypes: ["FOH_CONSUMABLE"] },
  { key: "cleaning", label: "Cleaning", validTypes: ["OPERATIONAL_SUPPLY"] },
  { key: "admin", label: "Admin", validTypes: ["OPERATIONAL_SUPPLY"] },
  {
    key: "other",
    label: "Other",
    validTypes: ["KITCHEN_INGREDIENT", "FOH_CONSUMABLE", "OPERATIONAL_SUPPLY"],
  },
] as const;

/** All category keys as a flat array */
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

/** Map from key → label for display */
export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c.label]),
);

/** Get categories valid for a given item type */
export function getCategoriesForType(itemType: ItemTypeKey): CategoryDef[] {
  return CATEGORIES.filter((c) => c.validTypes.includes(itemType));
}

/** Get the item type color config, or a neutral fallback */
export function getItemTypeStyle(itemType: string) {
  return (
    ITEM_TYPES[itemType as ItemTypeKey] ?? {
      key: itemType,
      label: itemType,
      color: "zinc",
      bgClass: "bg-zinc-500/15",
      textClass: "text-zinc-400",
      borderClass: "border-zinc-500/30",
      glowClass: "",
    }
  );
}

// ── Session Types ───────────────────────────────────────────

export const SESSION_TYPES = {
  REGULAR: { key: "REGULAR", label: "Stock Take" },
  OPENING: { key: "OPENING", label: "Opening Inventory" },
  CYCLE_COUNT: { key: "CYCLE_COUNT", label: "Cycle Count" },
} as const;

export type SessionTypeKey = keyof typeof SESSION_TYPES;

// ── Setup Progress (Location Onboarding) ────────────────────

export interface SetupStepDef {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}

export const SETUP_STEPS: readonly SetupStepDef[] = [
  {
    key: "location_created",
    label: "Location Created",
    description: "Location exists in the system",
  },
  {
    key: "items_activated",
    label: "Items Activated",
    description: "Catalog items selected for this location",
  },
  {
    key: "par_levels_set",
    label: "Par Levels Reviewed",
    description: "Minimum stock levels configured",
  },
  {
    key: "opening_count",
    label: "Opening Count Completed",
    description: "Initial stock quantities recorded",
  },
];

export const STATUS_LEGEND = {
  complete: { icon: "✓", color: "emerald", textClass: "text-emerald-400", label: "Complete" },
  warning: { icon: "⚠", color: "amber", textClass: "text-amber-400", label: "Needs Attention" },
  not_started: { icon: "✗", color: "red", textClass: "text-red-400", label: "Not Started" },
  in_progress: { icon: "⏳", color: "sky", textClass: "text-sky-400", label: "In Progress" },
} as const;

export type StatusKey = keyof typeof STATUS_LEGEND;

// ── Catalog Request Statuses ────────────────────────────────

export const CATALOG_REQUEST_STATUS = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

export type CatalogRequestStatusKey = keyof typeof CATALOG_REQUEST_STATUS;

// ── Purchase Order Statuses ─────────────────────────────────

export const PO_STATUS = {
  DRAFT: { key: "DRAFT", label: "Draft", color: "text-[#888]", bg: "bg-[#888]/10", border: "border-[#888]/20" },
  SUBMITTED: { key: "SUBMITTED", label: "Submitted", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  PARTIALLY_RECEIVED: { key: "PARTIALLY_RECEIVED", label: "Partial", color: "text-sky-400", bg: "bg-sky-500/10", border: "border-sky-500/20" },
  RECEIVED: { key: "RECEIVED", label: "Received", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  CANCELLED: { key: "CANCELLED", label: "Cancelled", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
} as const;

export type POStatusKey = keyof typeof PO_STATUS;

// ── Transfer Statuses ───────────────────────────────────────

export const TRANSFER_STATUS = {
  INITIATED: { key: "INITIATED", label: "Initiated", color: "text-[#888]", bg: "bg-[#888]/10", border: "border-[#888]/20" },
  SENT: { key: "SENT", label: "Sent", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  RECEIVED: { key: "RECEIVED", label: "Received", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  DISCREPANCY: { key: "DISCREPANCY", label: "Discrepancy", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
  CANCELLED: { key: "CANCELLED", label: "Cancelled", color: "text-zinc-500", bg: "bg-zinc-500/10", border: "border-zinc-500/20" },
} as const;

export type TransferStatusKey = keyof typeof TRANSFER_STATUS;

// ── Forecast Statuses ───────────────────────────────────────

export const FORECAST_STATUS = {
  ACTIVE: "ACTIVE",
  DISMISSED: "DISMISSED",
  ORDERED: "ORDERED",
} as const;

export type ForecastStatusKey = keyof typeof FORECAST_STATUS;

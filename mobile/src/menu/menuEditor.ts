/**
 * The menu item form: what is typed, the check before saving, the live cost preview and the save itself. The preview uses the shared web
 * editor functions (`previewLineCost`, `editorItemCosts`); what the server stores afterwards is its own figure and is what the item's
 * page shows.
 *
 * Saving needs a connection and takes several requests (the item, then its lines), none of which carries a key. `SaveSession` is what
 * makes pressing Save again safe after one of them failed: it remembers what is already on the server, and the rest is worked out from a
 * fresh read.
 */

import { editorItemCosts, normalizeUnit, previewLineCost, resolvableUnits, resolveQtyToKitchen, type CustomConversion, type EditorItemCosts } from "@culinaire/shared";
import type { ImportRecipe, MenuCatalogueItem, MenuItem, MenuLine } from "@culinaire/shared/schemas/menu";
import { ApiError } from "../api/client";

/** One recipe line as typed. `baseUnit` and the fields after it describe the linked catalogue item. */
export interface DraftLine {
  key: string;
  /** The server's row this line was read from. */
  existingId?: number;
  ingredientId: string | null;
  ingredientName: string;
  note: string | null;
  quantity: string;
  unit: string;
  /** Kept, and sent with a changed line, even when the person may not see it. "" = none: the server takes the catalogue's. */
  unitCost: string;
  yieldPct: string;
  baseUnit: string | null;
  contentQty: number | null;
  contentUnit: string | null;
  densityGPerMl: number | null;
  purchaseUnit: string | null;
  packQty: number | null;
}

export interface MenuDraft {
  name: string;
  category: string;
  sellingPrice: string;
  servings: string;
  servingsPerSale: string;
  qFactorPct: string;
  unitsSold: string;
  lines: DraftLine[];
}

/** The item as `POST` and `PATCH` take it. */
export interface ItemBody {
  name: string;
  category: string;
  sellingPrice: string;
  servings: number;
  servingsPerSale: number;
  qFactorPct: string;
  /** Only an edit can set it: the create route does not take it. */
  unitsSold?: number;
}

export interface LineBody {
  ingredientId: string | null;
  ingredientName: string;
  note: string | null;
  quantity: string;
  unit: string;
  unitCost?: string;
  yieldPct: string;
}

/** The units offered for a name that is not in the catalogue (IngredientsSection.tsx). */
export const FREE_UNITS = ["kg", "g", "mg", "L", "mL", "tsp", "tbsp", "cup", "fl oz", "each", "dozen", "portion", "bottle", "can", "bag", "box", "case", "bunch"];

let nextKey = 0;
const NO_ITEM = { baseUnit: null, contentQty: null, contentUnit: null, densityGPerMl: null, purchaseUnit: null, packQty: null };

export const blankLine = (): DraftLine => ({ key: `line${++nextKey}`, ingredientId: null, ingredientName: "", note: null, quantity: "", unit: "kg", unitCost: "", yieldPct: "100", ...NO_ITEM });

export const emptyDraft = (): MenuDraft => ({ name: "", category: "", sellingPrice: "", servings: "1", servingsPerSale: "1", qFactorPct: "0", unitsSold: "0", lines: [] });

const positive = (n: number | null | undefined): n is number => typeof n === "number" && n > 0;

const draftLineOf = (l: MenuLine): DraftLine => ({
  key: `line${++nextKey}`,
  existingId: l.id,
  ingredientId: l.ingredientId,
  ingredientName: l.ingredientName,
  note: l.note,
  quantity: String(l.quantity),
  unit: l.unit,
  // A linked line stored at 0 means "no cost of its own yet": the catalogue's, as the web shows it.
  unitCost: positive(l.unitCost) ? String(l.unitCost) : l.ingredientId && positive(l.catalogUnitCost) ? String(l.catalogUnitCost) : typeof l.unitCost === "number" ? String(l.unitCost) : "",
  yieldPct: String(l.yieldPct),
  baseUnit: l.ingredientId ? (l.baseUnit ?? l.unit) : null,
  contentQty: l.contentQty,
  contentUnit: l.contentUnit,
  densityGPerMl: l.densityGPerMl,
  purchaseUnit: l.purchaseUnit,
  packQty: l.packQty,
});

export const draftOf = (item: MenuItem, lines: MenuLine[]): MenuDraft => ({
  name: item.name,
  category: item.category,
  sellingPrice: item.sellingPrice.toFixed(2),
  servings: String(item.servings),
  servingsPerSale: String(item.servingsPerSale),
  qFactorPct: String(item.qFactorPct),
  unitsSold: String(item.unitsSold),
  lines: lines.map(draftLineOf),
});

/** The line linked to a catalogue item: its measured unit (else its kitchen unit) and its cost, when this person may see one. */
export const pickInto = (line: DraftLine, item: MenuCatalogueItem): DraftLine => {
  const cost = positive(item.preferredUnitCost) ? item.preferredUnitCost : item.unitCost;
  return {
    ...line,
    ingredientId: item.ingredientId,
    ingredientName: item.ingredientName,
    unit: item.contentUnit || item.baseUnit || line.unit,
    unitCost: positive(cost) ? String(cost) : "",
    baseUnit: item.baseUnit || line.unit,
    contentQty: item.contentQty,
    contentUnit: item.contentUnit,
    densityGPerMl: item.densityGPerMl,
    purchaseUnit: item.purchaseUnit,
    packQty: item.packQty,
  };
};

/** The line as typed under a name that is in no list: no longer linked, and no longer at the linked item's cost. */
export const typeName = (line: DraftLine, ingredientName: string): DraftLine => (line.ingredientId ? { ...line, ...NO_ITEM, ingredientId: null, ingredientName, unitCost: "" } : { ...line, ingredientName });

// ---------------------------------------------------------------------------
// Starting from a recipe
// ---------------------------------------------------------------------------

const DOMAIN_CATEGORY: Record<string, string> = { recipe: "Entrees", patisserie: "Desserts", spirits: "Beverages" };
const DISPLAY_UNIT: Record<string, string> = { l: "L", ml: "mL", floz: "fl oz" };
/** Units a recipe may carry that no menu line can: their grams. */
const GRAMS: Record<string, number> = { oz: 28.3495, lb: 453.592, lbs: 453.592 };

/** "1 1/2" -> 1.5, "1/2" -> 0.5, "0,25" -> 0.25, "2-3" -> 2; null when there is no number ("to taste"). */
function recipeAmount(raw: string): number | null {
  const fraction = /^\s*(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)/.exec(raw);
  if (fraction && Number(fraction[3]) > 0) return Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3]);
  const plain = /\d+(?:[.,]\d+)?/.exec(raw);
  return plain ? Number(plain[0].replace(",", ".")) : null;
}

/** A new draft from a saved recipe: its lines as typed names (not linked yet), the price left to set. */
export function draftFromRecipe(recipe: ImportRecipe): MenuDraft {
  const servings = /\d+/.exec(recipe.yield ?? "")?.[0];
  return {
    ...emptyDraft(),
    name: recipe.title,
    category: DOMAIN_CATEGORY[recipe.domain] ?? "",
    servings: String(Math.max(1, Number(servings ?? 1))),
    lines: recipe.ingredients.map((i) => {
      const unit = i.unit.trim().toLowerCase();
      const grams = GRAMS[unit];
      const known = normalizeUnit(unit);
      const qty = recipeAmount(i.amount);
      return {
        ...blankLine(),
        ingredientName: i.name,
        note: i.note,
        quantity: qty === null ? "" : String(Math.round(qty * (grams ?? 1) * 1000) / 1000),
        unit: grams ? "g" : known ? (DISPLAY_UNIT[known] ?? known) : FREE_UNITS.includes(unit) ? unit : "each",
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// The check before saving
// ---------------------------------------------------------------------------

/** What was typed as a plain decimal with at most `places` decimals ("0,5" -> "0.5"), or null. */
function decimal(typed: string, places: number): string | null {
  const t = typed.trim().replace(",", ".").replace(/^\./, "0.");
  return new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(t) ? t : null;
}

const dotted = (typed: string) => typed.trim().replace(",", ".");
const whole = (typed: string, min: number, max: number): number | null => (/^\d+$/.test(typed.trim()) && Number(typed) >= min && Number(typed) <= max ? Number(typed) : null);

export interface CheckedDraft {
  item: ItemBody;
  lines: DraftLine[];
}

/** The draft as the server takes it, or the sentence saying what to fix. The limits are the server's and its columns'. */
export function checkDraft(d: MenuDraft): CheckedDraft | { error: string } {
  const name = d.name.trim();
  if (!name || name.length > 200) return { error: "Give the item a name (up to 200 characters)." };
  const category = d.category.trim();
  if (!category || category.length > 50) return { error: "Choose a category, or type a new one (up to 50 characters)." };
  const price = decimal(d.sellingPrice, 2);
  if (price === null || Number(price) >= 1e8) return { error: "Enter the selling price, for example 24 or 24.50." };
  const servingsPerSale = whole(d.servingsPerSale, 1, 999);
  if (servingsPerSale === null) return { error: "Enter how many servings the price covers, 1 to 999." };
  const servings = whole(d.servings, 1, 999);
  if (servings === null) return { error: "Enter how many servings the recipe makes, 1 to 999." };
  const q = d.qFactorPct.trim() === "" ? "0" : decimal(d.qFactorPct, 2);
  if (q === null || Number(q) > 50) return { error: "Enter the Q factor as a percentage from 0 to 50." };
  const unitsSold = whole(d.unitsSold.trim() || "0", 0, 99_999_999);
  if (unitsSold === null) return { error: "Enter the units sold as a whole number, 0 or more." };

  const lines: DraftLine[] = [];
  for (const l of d.lines) {
    const ingredientName = l.ingredientName.trim();
    if (!ingredientName && !l.quantity.trim()) continue;
    if (!ingredientName || ingredientName.length > 200) return { error: "Give every ingredient a name (up to 200 characters)." };
    const quantity = decimal(l.quantity, 3);
    if (quantity === null || Number(quantity) >= 1e7) return { error: `Enter how much ${ingredientName}, with up to 3 decimals.` };
    const unitCost = l.unitCost.trim() === "" ? "" : decimal(l.unitCost, 4);
    if (unitCost === null || Number(unitCost) >= 1e6) return { error: `Enter the cost of ${ingredientName} as a number, or leave it empty.` };
    const yieldPct = l.yieldPct.trim() === "" ? "100" : decimal(l.yieldPct, 2);
    if (yieldPct === null || Number(yieldPct) < 1 || Number(yieldPct) > 200) return { error: `Enter the yield of ${ingredientName} as a percentage from 1 to 200.` };
    lines.push({ ...l, ingredientName, quantity, unitCost, yieldPct });
  }
  return { item: { name, category, sellingPrice: Number(price).toFixed(2), servings, servingsPerSale, qFactorPct: String(Number(q)), unitsSold }, lines };
}

// ---------------------------------------------------------------------------
// The live preview
// ---------------------------------------------------------------------------

/** The quantity in the linked item's kitchen unit, or null when the units have no path between them. */
function toKitchenQty(line: DraftLine, qty: number, conversions: CustomConversion[]): number | null {
  if (!line.baseUnit || line.unit === line.baseUnit) return qty;
  try {
    return resolveQtyToKitchen({ ...line, baseUnit: line.baseUnit }, qty, line.unit, conversions);
  } catch {
    return null;
  }
}

/** The units a line can be in: what the linked item resolves (and the line's own unit), or the plain list for a typed name. */
export function unitsFor(line: DraftLine, conversions: CustomConversion[]): string[] {
  if (!line.ingredientId || !line.baseUnit) return FREE_UNITS.includes(line.unit) ? FREE_UNITS : [line.unit, ...FREE_UNITS];
  const units = resolvableUnits({ ...line, baseUnit: line.baseUnit }, conversions);
  return units.some((u) => u.toLowerCase() === line.unit.toLowerCase()) ? units : [line.unit, ...units];
}

/** A line's cost as the web editor previews it: null for a linked item with no cost yet; `mismatch` when its unit cannot become the kitchen unit. */
export function linePreview(line: DraftLine, conversions: CustomConversion[]): { cost: number | null; mismatch: boolean } {
  const mismatch = line.ingredientId !== null && toKitchenQty(line, 1, conversions) === null;
  const unitCost = dotted(line.unitCost);
  if (line.ingredientId && !(parseFloat(unitCost) > 0)) return { cost: null, mismatch };
  return { cost: previewLineCost({ quantity: dotted(line.quantity), unitCost, yieldPct: dotted(line.yieldPct) }, (qty) => toKitchenQty(line, qty, conversions)), mismatch };
}

export function draftCosts(d: MenuDraft, conversionsFor: (ingredientId: string | null) => CustomConversion[]): EditorItemCosts & { batch: number } {
  const batch = d.lines.reduce((sum, l) => sum + (linePreview(l, conversionsFor(l.ingredientId)).cost ?? 0), 0);
  return { batch, ...editorItemCosts({ totalBatchCost: batch, servings: Number(d.servings) || 1, qFactorPct: dotted(d.qFactorPct), servingsPerSale: Number(d.servingsPerSale) || 1, sellingPrice: dotted(d.sellingPrice) }) };
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

/** The same content; a draft without a cost matches any (the server filled it in from the catalogue). */
function sameLine(d: DraftLine, row: MenuLine): boolean {
  return (
    d.ingredientId === row.ingredientId &&
    d.ingredientName === row.ingredientName &&
    (d.note ?? "") === (row.note ?? "") &&
    Number(d.quantity) === row.quantity &&
    d.unit === row.unit &&
    Number(d.yieldPct) === row.yieldPct &&
    (d.unitCost === "" || typeof row.unitCost !== "number" || Number(d.unitCost) === row.unitCost)
  );
}

/**
 * The lines to add and the rows to remove. There is no route that changes a line, so a changed one is added anew and its old row removed;
 * an untouched one is left alone. A row that is not in `baseline` (what this person started from) is someone else's, or a line of an
 * earlier try of this save: never removed, and taken as the draft line with the same content.
 */
export function planLines(draft: DraftLine[], baseline: MenuLine[], server: MenuLine[]): { add: DraftLine[]; remove: number[] } {
  const started = new Map(baseline.map((r) => [r.id, r]));
  const landed = server.filter((r) => !started.has(r.id));
  const keep = new Set<number>();
  const add: DraftLine[] = [];
  for (const d of draft) {
    const from = d.existingId === undefined ? undefined : started.get(d.existingId);
    if (from && sameLine(d, from)) {
      keep.add(from.id);
      continue;
    }
    const i = landed.findIndex((r) => sameLine(d, r));
    if (i >= 0) landed.splice(i, 1);
    else add.push(d);
  }
  return { add, remove: server.filter((r) => started.has(r.id) && !keep.has(r.id)).map((r) => r.id) };
}

/** What one open editor knows is on the server. The screen keeps it for as long as the form is open. */
export interface SaveSession {
  itemId: string | null;
  item: ItemBody | null;
  lines: MenuLine[];
  /** A create whose reply was lost: what was sent, and the items there were before it. */
  attempt: { body: ItemBody; known: Set<string> } | null;
}

const bodyOf = (i: MenuItem): ItemBody => ({ name: i.name, category: i.category, sellingPrice: i.sellingPrice.toFixed(2), servings: i.servings, servingsPerSale: i.servingsPerSale, qFactorPct: String(i.qFactorPct), unitsSold: i.unitsSold });

export const saveSession = (item?: MenuItem, lines: MenuLine[] = []): SaveSession => ({ itemId: item?.menuItemId ?? null, item: item ? bodyOf(item) : null, lines, attempt: null });

export interface EditorApi {
  items(): Promise<MenuItem[]>;
  lines(menuItemId: string): Promise<MenuLine[]>;
  create(body: ItemBody): Promise<{ menuItemId: string }>;
  update(menuItemId: string, changes: Partial<ItemBody>): Promise<unknown>;
  addLine(menuItemId: string, line: LineBody): Promise<unknown>;
  removeLine(menuItemId: string, rowId: number): Promise<unknown>;
}

/** The server may have acted on a request that ended like this. */
export const mayHaveLanded = (err: unknown) => !(err instanceof ApiError) || ["network", "timeout", "server", "bad_response", "aborted"].includes(err.code);

const lineBody = ({ ingredientId, ingredientName, note, quantity, unit, unitCost, yieldPct }: DraftLine): LineBody => ({ ingredientId, ingredientName, note, quantity, unit, yieldPct, ...(Number(unitCost) > 0 ? { unitCost } : {}) });

/** Saves the checked draft and answers the item's id. Throws what the server said; pressing Save again carries on from there. */
export async function saveMenuItem(api: EditorApi, session: SaveSession, { item, lines }: CheckedDraft, userId: number): Promise<string> {
  if (session.itemId === null) {
    // Read first: it finds what a lost reply left behind, and with no signal it stops here with nothing sent.
    const items = await api.items();
    const { unitsSold: _unitsSold, ...body } = item;
    const { attempt } = session;
    const landed = attempt && items.find((i) => !attempt.known.has(i.menuItemId) && (i.userId ?? userId) === userId && (Object.keys(attempt.body) as (keyof ItemBody)[]).every((k) => bodyOf(i)[k] === attempt.body[k]));
    if (landed) {
      session.itemId = landed.menuItemId;
      session.item = { ...attempt.body };
    } else {
      session.attempt = { body, known: new Set(items.map((i) => i.menuItemId)) };
      try {
        session.itemId = (await api.create(body)).menuItemId;
      } catch (err) {
        if (!mayHaveLanded(err)) session.attempt = null;
        throw err;
      }
      session.item = body;
    }
  }
  const itemId = session.itemId;

  const before = session.item!;
  const changes = Object.fromEntries(Object.entries(item).filter(([k, v]) => (k !== "unitsSold" || before.unitsSold !== undefined) && before[k as keyof ItemBody] !== v)) as Partial<ItemBody>;
  if (Object.keys(changes).length > 0) {
    await api.update(itemId, changes);
    session.item = { ...before, ...changes };
  }

  if (lines.length > 0 || session.lines.length > 0) {
    const { add, remove } = planLines(lines, session.lines, await api.lines(itemId));
    // Added before the old ones go: a failure in between leaves a line twice, which shows, and never loses one.
    for (const l of add) await api.addLine(itemId, lineBody(l));
    for (const id of remove) await api.removeLine(itemId, id);
  }
  return itemId;
}

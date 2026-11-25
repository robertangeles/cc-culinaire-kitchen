import type { MenuIngredient } from "../../hooks/useMenuItems.js";

/** A recipe line as the form saves it. `existingId` is the server row it was read from. */
export interface LineToSave {
  existingId?: number;
  ingredientId?: string | null;
  ingredientName: string;
  note?: string | null;
  quantity: string;
  unit: string;
  unitCost?: string;
  yieldPct: string;
}

const sameLine = (line: LineToSave, row: MenuIngredient): boolean =>
  (line.ingredientId ?? null) === (row.ingredientId ?? null) &&
  line.ingredientName === row.ingredientName &&
  (line.note ?? null) === (row.note ?? null) &&
  Number(line.quantity) === Number(row.quantity) &&
  line.unit === row.unit &&
  Number(line.yieldPct) === Number(row.yieldPct);

/**
 * The lines to add and the rows to remove when the person saving cannot see costs. Removing every row and adding it
 * back, as a save with costs does, would throw the unseen costs away: an untouched line is left alone. Add before
 * removing, so the server can carry a changed line's cost over from its old version.
 */
export function planHiddenCostSave(lines: LineToSave[], rows: MenuIngredient[]): { add: LineToSave[]; remove: number[] } {
  const keep = new Set<number>();
  const add: LineToSave[] = [];
  for (const line of lines) {
    const row = rows.find((r) => r.id === line.existingId);
    if (row && sameLine(line, row)) keep.add(row.id);
    else add.push(line);
  }
  return { add, remove: rows.filter((r) => !keep.has(r.id)).map((r) => r.id) };
}

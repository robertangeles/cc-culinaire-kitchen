/** One line telling whoever reordered which items' quantities to check; null when there is nothing to check. */
export function reorderCheckLine(warnings: readonly { ingredientName: string | null }[]): string | null {
  if (warnings.length === 0) return null;
  const names = warnings.map((w) => w.ingredientName ?? "an item").join(", ");
  return `Check the quantity of ${names}: a unit could not be converted, so the last order's quantity may have been kept.`;
}

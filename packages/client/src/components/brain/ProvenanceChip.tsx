/**
 * @module components/brain/ProvenanceChip
 *
 * Small provenance label on a memory row — "from a chat · Jul 2", or
 * "Maria · from the waste log · Jul 8" on a shared row (docs/specs/brain-memory.md
 * D-T2 / T14c). Quiet by design: provenance is tertiary information, so it reads
 * as a caption, not a badge — the author folds inline, it does not get its own pill.
 */

/** Kitchen-native labels per memory source type. */
const SOURCE_LABELS: Record<string, string> = {
  chat: "a chat",
  recipe: "a recipe",
  purchase_order: "purchasing",
  waste: "the waste log",
  stock: "the stock room",
  menu: "the menu",
  prep: "prep",
};

export function ProvenanceChip({
  sourceType,
  createdDttm,
  authorName,
}: {
  sourceType: string;
  createdDttm: string;
  /** Author of a shared memory (spec T14c). Folds inline; omitted on own rows. */
  authorName?: string | null;
}) {
  const when = new Date(createdDttm).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return (
    <span className="text-xs text-[#777777]">
      {authorName ? `${authorName} · ` : ""}from {SOURCE_LABELS[sourceType] ?? sourceType} · {when}
    </span>
  );
}

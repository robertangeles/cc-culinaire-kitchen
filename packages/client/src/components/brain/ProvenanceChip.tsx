/**
 * @module components/brain/ProvenanceChip
 *
 * Small provenance label on a memory row — "from a chat · Jul 2"
 * (docs/specs/brain-memory.md D-T2). Quiet by design: provenance is
 * tertiary information, so it reads as a caption, not a badge.
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
}: {
  sourceType: string;
  createdDttm: string;
}) {
  const when = new Date(createdDttm).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return (
    <span className="text-xs text-[#777777]">
      from {SOURCE_LABELS[sourceType] ?? sourceType} · {when}
    </span>
  );
}

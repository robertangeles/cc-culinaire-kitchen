/** What a memory says about itself, in the web's words (`ProvenanceChip`, `MemoryRow`, the source chips of `YourBrainPage`). */

import type { Memory } from "@culinaire/shared/schemas/brain";
import type { AuthUser } from "../api/auth";
import { hasAnyPermission } from "../shell/tabs";

/** The web's source filters. */
export const SOURCES: { label: string; value: string | null }[] = [
  { label: "All", value: null },
  { label: "Chat", value: "chat" },
  { label: "Recipes", value: "recipe" },
  { label: "Purchasing", value: "purchase_order" },
  { label: "Waste", value: "waste" },
  { label: "Stock", value: "stock" },
  { label: "Menu", value: "menu" },
  { label: "Prep", value: "prep" },
];

const FROM: Record<string, string> = { chat: "a chat", recipe: "a recipe", purchase_order: "purchasing", waste: "the waste log", stock: "the stock room", menu: "the menu", prep: "prep" };

export const memoryLabel = (m: Memory) => m.title || m.body.slice(0, 100);

/** "Maria · from the waste log · 8 Jul". */
export function provenance(m: Memory): string {
  const when = m.createdDttm ? new Date(m.createdDttm).toLocaleDateString([], { day: "numeric", month: "short" }) : "";
  return [m.authorName, m.sourceType ? `from ${FROM[m.sourceType] ?? m.sourceType}` : "", when].filter(Boolean).join(" · ");
}

export const isLearning = (m: Memory) => m.status === "pending" || m.status === "processing";

/** The server's say on this row and the key its delete route asks for. */
export const canRemove = (user: AuthUser, m: Memory) => m.canManage && hasAnyPermission(user, ["brain:manage"]);

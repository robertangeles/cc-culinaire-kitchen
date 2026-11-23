/**
 * One recipe on screen: read it, refine it (a proposal the owner accepts or discards; nothing is saved before Accept), and the
 * owner's public or private switch. The server enforces ownership; the phone only hides what the person cannot do.
 */

import { ApiError } from "../api/client";
import type { Recipe } from "@culinaire/shared/schemas/recipe";
import type { RecipeApi } from "./recipeApi";
import { recipeFailure, type RecipeFailure } from "./labStore";

export type RefineState =
  | { phase: "idle"; failure: RecipeFailure | null }
  | { phase: "refining" }
  | { phase: "proposal"; refinedData: unknown; changeSummary: string; failure: RecipeFailure | null }
  | { phase: "accepting"; refinedData: unknown; changeSummary: string };

export interface RecipeSnapshot {
  phase: "loading" | "ready" | "error";
  recipe: Recipe | null;
  error: string | null;
  /** Only the owner gets `userId` back from the server. */
  isOwner: boolean;
  refine: RefineState;
  visibilityError: string | null;
}

/** The server's limits for an instruction (`3..1000`). */
export const INSTRUCTION_MIN = 3;
export const INSTRUCTION_MAX = 1000;

export function createRecipeStore({ api, recipeId, userId }: { api: RecipeApi; recipeId: string; userId: number }) {
  let snapshot: RecipeSnapshot = { phase: "loading", recipe: null, error: null, isOwner: false, refine: { phase: "idle", failure: null }, visibilityError: null };
  const listeners = new Set<() => void>();
  let controller: AbortController | null = null;

  const set = (next: Partial<RecipeSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };
  const show = (recipe: Recipe) => set({ phase: "ready", recipe, error: null, isOwner: recipe.userId === userId });

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,

    async load(): Promise<void> {
      if (!snapshot.recipe) set({ phase: "loading" });
      try {
        show(await api.get(recipeId));
      } catch (err) {
        const gone = err instanceof ApiError && (err.code === "not_found" || err.code === "forbidden");
        set({ phase: snapshot.recipe ? "ready" : "error", error: gone ? "This recipe isn't available. It may be private or deleted." : recipeFailure(err).message });
      }
    },

    async refine(instruction: string): Promise<void> {
      const text = instruction.trim();
      if (text.length < INSTRUCTION_MIN || snapshot.refine.phase === "refining" || snapshot.refine.phase === "accepting") return;
      controller = new AbortController();
      const signal = controller.signal;
      set({ refine: { phase: "refining" } });
      try {
        const reply = await api.refine(recipeId, text.slice(0, INSTRUCTION_MAX), signal);
        set({ refine: { phase: "proposal", refinedData: reply.refinedData, changeSummary: reply.changeSummary, failure: null } });
      } catch (err) {
        set({ refine: { phase: "idle", failure: signal.aborted ? null : recipeFailure(err, "refine recipes") } });
      } finally {
        controller = null;
      }
    },
    stopRefine: () => controller?.abort(),
    discard: () => set({ refine: { phase: "idle", failure: null } }),

    async accept(): Promise<void> {
      const r = snapshot.refine;
      if (r.phase !== "proposal") return;
      set({ refine: { phase: "accepting", refinedData: r.refinedData, changeSummary: r.changeSummary } });
      try {
        await api.accept(recipeId, r.refinedData, r.changeSummary.slice(0, INSTRUCTION_MAX));
        show(await api.get(recipeId));
        set({ refine: { phase: "idle", failure: null } });
      } catch (err) {
        set({ refine: { ...r, failure: recipeFailure(err, "refine recipes") } });
      }
    },

    async setPublic(isPublic: boolean): Promise<void> {
      const recipe = snapshot.recipe;
      if (!recipe || !snapshot.isOwner) return;
      set({ recipe: { ...recipe, isPublicInd: isPublic }, visibilityError: null });
      try {
        await api.setPublic(recipeId, isPublic);
      } catch (err) {
        set({ recipe: { ...snapshot.recipe!, isPublicInd: recipe.isPublicInd }, visibilityError: recipeFailure(err).message });
      }
    },

    dispose: () => controller?.abort(),
  };
}

export type RecipeStore = ReturnType<typeof createRecipeStore>;

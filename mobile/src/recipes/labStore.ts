/**
 * Recipe Lab: one generation at a time, honest about the long wait. The server saves the recipe only when it is made: a stop,
 * a time-out or a model failure saves nothing and costs nothing (PR 215). Only a reply lost after the server finished can leave
 * a saved recipe the phone never heard about, so after a lost reply or a stop the phone looks at the shelf: a recipe that was
 * not there when the request began is offered ("is it this one?") instead of making a second one. "Nothing was saved" is said
 * only when that look worked and shows no new recipe.
 */

import { ApiError } from "../api/client";
import type { RecipeApi, RecipeRequest } from "./recipeApi";

export interface RecipeFailure {
  message: string;
  canRetry: boolean;
}

export interface LabSnapshot {
  phase: "form" | "generating" | "checking" | "made" | "found" | "prose" | "failed";
  /** When the current generation began (the phone's clock), for the elapsed time on screen. */
  startedAt: number | null;
  /** The recipe just made, with the titles of the kitchen notes it drew on (a title can be null). */
  made: { recipeId: string; grounded: (string | null)[] } | null;
  /** After a lost reply or a stop: a recipe that was not on the shelf when the request began. It may be this one. */
  found: { recipeId: string; title: string } | null;
  prose: string | null;
  failure: RecipeFailure | null;
  /** The failure is a lost reply and the shelf could not be read: whether a recipe was saved is not known. */
  unchecked: boolean;
  /** A line for the form, after a stop. */
  note: string | null;
}

const NOTHING_SAVED_TIMEOUT = "That took too long. Nothing was saved. Try again.";
const UNCHECKED = "The phone could not check whether a recipe was saved. Look in My Recipes before trying again.";

/** Refusals of generate and refine, from the server's code. `what` finishes "Sign in again to …". */
export function recipeFailure(err: unknown, what = "make recipes"): RecipeFailure {
  if (!(err instanceof ApiError)) return { message: "Something went wrong. Try again.", canRetry: true };
  if (err.hasCode("FREE_SESSIONS_EXHAUSTED")) return { message: "You've used all your free sessions.", canRetry: false };
  if (err.code === "unauthorized") return { message: `You've been signed out. Sign in again to ${what}.`, canRetry: false };
  if (err.hasCode("RATE_LIMITED") || err.code === "rate_limited") return { message: "You've made a lot of recipes in a short time. Wait a few minutes, then try again.", canRetry: true };
  if (err.hasCode("AI_UNAVAILABLE")) return { message: "Recipe generation isn't available right now. Nothing was saved. Try again in a few minutes.", canRetry: true };
  if (err.hasCode("AI_TIMEOUT") || err.code === "timeout") return { message: NOTHING_SAVED_TIMEOUT, canRetry: true };
  if (err.code === "network") return { message: "Can't reach the server. Check your signal and try again.", canRetry: true };
  // A 400 (VALIDATION) carries the server's own sentence; asking again unchanged cannot help.
  return { message: err.message, canRetry: err.code !== "bad_request" && err.code !== "forbidden" };
}

/** The reply may have been lost after the server saved: worth a look at the shelf. */
const mayHaveSaved = (err: unknown) => err instanceof ApiError && (err.code === "network" || err.code === "timeout" || err.code === "aborted");

export function createLabStore({ api, now }: { api: RecipeApi; now: () => number }) {
  const empty: LabSnapshot = { phase: "form", startedAt: null, made: null, found: null, prose: null, failure: null, unchecked: false, note: null };
  let snapshot = empty;
  const listeners = new Set<() => void>();
  let controller: AbortController | null = null;
  let last: RecipeRequest | null = null;
  // What the check after a lost reply or a stop compares with and reports.
  let before: string[] = [];
  let stopped = false;
  let lost = "";

  const set = (next: Partial<LabSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };

  /** The newest of my culinary recipes. */
  const shelf = () => api.mine(1, "recipe", 5).then((p) => p.recipes);

  /** After a lost reply or a stop: is there a recipe that was not on the shelf when the request began? */
  async function check(): Promise<void> {
    set({ ...empty, phase: "checking" });
    const after = await shelf().catch(() => null);
    const fresh = after?.find((r) => !before.includes(r.recipeId));
    if (fresh) set({ phase: "found", found: { recipeId: fresh.recipeId, title: fresh.title } });
    else if (!after) set({ phase: "failed", unchecked: true, failure: { message: `${stopped ? "Stopped." : "The reply was lost."} ${UNCHECKED}`, canRetry: true } });
    else if (stopped) set({ ...empty, note: "Stopped. Nothing was saved." });
    else set({ phase: "failed", failure: { message: lost, canRetry: true } });
  }

  async function generate(form: RecipeRequest): Promise<void> {
    if (snapshot.phase === "generating" || snapshot.phase === "checking") return;
    last = form;
    controller = new AbortController();
    const signal = controller.signal;
    set({ ...empty, phase: "generating", startedAt: now() });
    let sent = false;
    try {
      // Without the shelf as it is now, a lost reply could not be checked afterwards: the request is not sent.
      before = (await shelf()).map((r) => r.recipeId);
      if (signal.aborted) throw new ApiError("aborted");
      sent = true;
      const reply = await api.generate(form, signal);
      if ("prose" in reply) set({ phase: "prose", prose: reply.prose });
      else if (reply.recipeId) set({ phase: "made", made: { recipeId: reply.recipeId, grounded: (reply.brainGrounded ?? []).map((m) => m.title) } });
      else set({ phase: "failed", failure: { message: "The recipe was made but not saved. Try again.", canRetry: true } });
    } catch (err) {
      stopped = signal.aborted;
      if (!sent) set(stopped ? { ...empty, note: "Stopped. Nothing was saved." } : { phase: "failed", failure: recipeFailure(err) });
      else if (mayHaveSaved(err)) {
        lost = err instanceof ApiError && err.code === "timeout" ? NOTHING_SAVED_TIMEOUT : "The connection dropped and nothing was saved. Try again.";
        await check();
      } else set({ phase: "failed", failure: recipeFailure(err) });
    } finally {
      controller = null;
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    generate,
    /** The same form again, from the start. */
    retry: () => (last && (snapshot.phase === "failed" || snapshot.phase === "found") ? generate(last) : Promise.resolve()),
    /** Another look at the shelf, when the last one could not be made. */
    checkAgain: () => (snapshot.phase === "failed" && snapshot.unchecked ? check() : Promise.resolve()),
    stop: () => controller?.abort(),
    reset: () => set(empty),
    dispose: () => controller?.abort(),
  };
}

export type LabStore = ReturnType<typeof createLabStore>;

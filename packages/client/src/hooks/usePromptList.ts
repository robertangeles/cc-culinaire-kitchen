/**
 * @module usePromptList
 *
 * Custom hook for fetching and managing the list of all prompts.
 * Used by the PromptsTab to display prompt names as selectable tabs
 * and to create new prompts via the API.
 */

import { useState, useEffect, useCallback } from "react";

/** Prompt summary returned by the list endpoint (no body). */
export interface PromptSummary {
  promptId: number;
  promptName: string;
  promptKey: string | null;
  updatedDttm: string;
  createdDttm: string;
}

/** Shape returned by the {@link usePromptList} hook. */
interface UsePromptListReturn {
  /** Array of prompt summaries (active copies only). */
  prompts: PromptSummary[];
  /** True while the list is being fetched. */
  isLoading: boolean;
  /** Error message if the fetch failed. */
  error: string | null;
  /** Re-fetch the prompt list from the server. */
  refresh: () => Promise<void>;
  /** Create a new prompt and refresh the list. */
  create: (name: string, content: string) => Promise<PromptSummary>;
}

/**
 * Fetches the list of all active prompts on mount and provides
 * a `create` function for adding new prompts.
 *
 * @returns Prompt list state and actions — see {@link UsePromptListReturn}.
 */
export function usePromptList(): UsePromptListReturn {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/prompts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load prompts");
      const data = await res.json();
      setPrompts(data.prompts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prompts");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (name: string, content: string): Promise<PromptSummary> => {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, content }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create prompt");
      }

      const data = await res.json();
      await refresh();
      return data.prompt;
    },
    [refresh]
  );

  return { prompts, isLoading, error, refresh, create };
}

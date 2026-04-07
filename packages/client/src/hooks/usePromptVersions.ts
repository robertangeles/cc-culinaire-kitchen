/**
 * @module usePromptVersions
 *
 * Custom hook for fetching prompt version history and rolling back to a
 * previous version via the `/api/prompts/:name/versions` endpoints.
 */

import { useState, useCallback } from "react";

/** A single prompt version snapshot returned by the API. */
export interface PromptVersion {
  versionId: number;
  promptId: number;
  promptBody: string;
  modelId: string | null;
  versionNumber: number;
  createdDttm: string;
}

/** Shape returned by the {@link usePromptVersions} hook. */
interface UsePromptVersionsReturn {
  /** List of version snapshots, newest first. */
  versions: PromptVersion[];
  /** True while the version list is being fetched. */
  isLoading: boolean;
  /** True while a rollback request is in flight. */
  isRollingBack: boolean;
  /** Most recent error message, or null. */
  error: string | null;
  /** Fetch the version list from the server. */
  fetchVersions: () => Promise<void>;
  /** Restore a previous version and return the restored content. */
  rollback: (versionId: number) => Promise<string | null>;
}

/**
 * Manages prompt version history: list versions and rollback to a previous one.
 *
 * @param name - Prompt identifier (e.g. `"systemPrompt"`).
 * @returns Version state and actions — see {@link UsePromptVersionsReturn}.
 */
export function usePromptVersions(name: string): UsePromptVersionsReturn {
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/prompts/${name}/versions`);
      if (!res.ok) throw new Error("Failed to load versions");
      const data = await res.json();
      setVersions(data.versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load versions");
    } finally {
      setIsLoading(false);
    }
  }, [name]);

  const rollback = useCallback(
    async (versionId: number): Promise<string | null> => {
      setIsRollingBack(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/prompts/${name}/versions/${versionId}/rollback`,
          { method: "POST" }
        );
        if (!res.ok) throw new Error("Failed to rollback");
        const data = await res.json();
        // Refresh the version list after rollback
        await fetchVersions();
        return data.content as string;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Rollback failed");
        return null;
      } finally {
        setIsRollingBack(false);
      }
    },
    [name, fetchVersions]
  );

  return {
    versions,
    isLoading,
    isRollingBack,
    error,
    fetchVersions,
    rollback,
  };
}

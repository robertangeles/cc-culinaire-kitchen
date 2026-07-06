/**
 * @module hooks/useBrainMemories
 *
 * Data hook for the "Your Brain" page (docs/specs/brain-memory.md T8).
 * Lists and deletes the signed-in user's Brain memories via the
 * `/api/brain/memories` REST endpoints (cookie-authenticated).
 */

import { useState, useEffect, useCallback } from "react";

/** One memory row as returned by GET /api/brain/memories. */
export interface BrainMemory {
  memoryId: string;
  title: string | null;
  body: string;
  sourceType: string;
  scope: string;
  /** 'pending' | 'processing' render the "learning…" chip; 'ready' | 'failed'. */
  status: string;
  createdDttm: string;
}

interface UseBrainMemoriesReturn {
  memories: BrainMemory[];
  total: number;
  isLoading: boolean;
  /** Plain-language load error, or null. */
  error: string | null;
  search: string;
  setSearch: (value: string) => void;
  /** Re-fetch with the current search term (used by the retry button). */
  reload: () => void;
  /** Delete a memory; resolves true on success, false on failure. */
  remove: (memoryId: string) => Promise<boolean>;
}

/**
 * Fetches the user's memories (newest first), debouncing search input,
 * and exposes an optimistic-removal delete.
 */
export function useBrainMemories(): UseBrainMemoriesReturn {
  const [memories, setMemories] = useState<BrainMemory[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async (searchTerm: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (searchTerm.trim()) params.set("search", searchTerm.trim());
      const res = await fetch(`/api/brain/memories?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { memories: BrainMemory[]; total: number };
      setMemories(data.memories);
      setTotal(data.total);
    } catch {
      setError("Couldn't load your memories — try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load on mount; debounce subsequent search keystrokes.
  useEffect(() => {
    const timer = setTimeout(() => void load(search), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, load]);

  const remove = useCallback(async (memoryId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/brain/memories/${memoryId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) return false;
      setMemories((prev) => prev.filter((m) => m.memoryId !== memoryId));
      setTotal((t) => Math.max(0, t - 1));
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    memories,
    total,
    isLoading,
    error,
    search,
    setSearch,
    reload: () => void load(search),
    remove,
  };
}

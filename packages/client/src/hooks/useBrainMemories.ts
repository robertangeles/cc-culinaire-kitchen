/**
 * @module hooks/useBrainMemories
 *
 * Data hook for the "Your Brain" page (docs/specs/brain-memory.md T8/T14b).
 * Lists, filters, and manages the signed-in user's Brain memories via the
 * `/api/brain/memories` REST endpoints (cookie-authenticated).
 */

import { useState, useEffect, useCallback } from "react";

/** One memory row as returned by GET /api/brain/memories. */
export interface BrainMemory {
  memoryId: string;
  title: string | null;
  body: string;
  sourceType: string;
  /** 'user' (private) | 'org' (shared with the kitchen). */
  scope: string;
  /** Pinned memories sort first (spec T14b). */
  isPinned: boolean;
  /** 'pending' | 'processing' render the "learning…" chip; 'ready' | 'failed'. */
  status: string;
  createdDttm: string;
  /** Whether the viewer may pin/edit/share/delete this row (spec T14c) — gates row actions. */
  canManage: boolean;
  /** Author label for shared rows ("Maria" / "Former team member"); null on your own rows. */
  authorName: string | null;
}

/** Scope segmented-control value (D-T4): 'user' = Private, 'org' = Shared. */
export type ScopeFilter = "user" | "org";

interface UseBrainMemoriesReturn {
  memories: BrainMemory[];
  total: number;
  isLoading: boolean;
  /** Plain-language load error, or null. */
  error: string | null;
  search: string;
  setSearch: (value: string) => void;
  scopeFilter: ScopeFilter;
  setScopeFilter: (value: ScopeFilter) => void;
  /** Source-type filter (e.g. "chat"), or null for all. */
  sourceTypeFilter: string | null;
  setSourceTypeFilter: (value: string | null) => void;
  /** Re-fetch with the current filters (used by the retry button). */
  reload: () => void;
  /** Delete a memory; resolves true on success. */
  remove: (memoryId: string) => Promise<boolean>;
  /** Pin/unpin a memory; resolves true on success. */
  pin: (memoryId: string, pinned: boolean) => Promise<boolean>;
  /** Correct a memory's body (→ re-embed); resolves true on success. */
  correct: (memoryId: string, body: string) => Promise<boolean>;
  /** Share (→ 'org') or un-share (→ 'user') a memory; resolves true on success. */
  toggleScope: (memoryId: string, scope: "user" | "org") => Promise<boolean>;
}

/** Pinned first, then newest — mirrors the server's `is_pinned DESC, created_dttm DESC`. */
function sortMemories(list: BrainMemory[]): BrainMemory[] {
  return [...list].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return b.createdDttm.localeCompare(a.createdDttm);
  });
}

async function patchMemory(pathSuffix: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(`/api/brain/memories/${pathSuffix}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetches the user's memories (pinned first, then newest), debouncing search,
 * and exposes optimistic pin / correct / scope-toggle / delete mutations.
 */
export function useBrainMemories(): UseBrainMemoriesReturn {
  const [memories, setMemories] = useState<BrainMemory[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("user"); // default: Private
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string | null>(null);

  const load = useCallback(
    async (searchTerm: string, scope: ScopeFilter, sourceType: string | null) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "100" });
        if (searchTerm.trim()) params.set("search", searchTerm.trim());
        params.set("scope", scope);
        if (sourceType) params.set("sourceType", sourceType);
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
    },
    [],
  );

  // Load on mount; debounce search keystrokes; refetch on filter change.
  useEffect(() => {
    const timer = setTimeout(
      () => void load(search, scopeFilter, sourceTypeFilter),
      search ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [search, scopeFilter, sourceTypeFilter, load]);

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

  const pin = useCallback(async (memoryId: string, pinned: boolean): Promise<boolean> => {
    const ok = await patchMemory(`${memoryId}/pin`, { pinned });
    if (ok) {
      setMemories((prev) =>
        sortMemories(prev.map((m) => (m.memoryId === memoryId ? { ...m, isPinned: pinned } : m))),
      );
    }
    return ok;
  }, []);

  const correct = useCallback(async (memoryId: string, body: string): Promise<boolean> => {
    const ok = await patchMemory(`${memoryId}`, { body });
    if (ok) {
      // Body changed → the row re-enters the embed queue ('learning…').
      setMemories((prev) =>
        prev.map((m) => (m.memoryId === memoryId ? { ...m, body, status: "pending" } : m)),
      );
    }
    return ok;
  }, []);

  const toggleScope = useCallback(
    async (memoryId: string, scope: "user" | "org"): Promise<boolean> => {
      const ok = await patchMemory(`${memoryId}/scope`, { scope });
      if (ok) {
        setMemories((prev) => {
          const updated = prev.map((m) => (m.memoryId === memoryId ? { ...m, scope } : m));
          // The row moved to the other tab — drop it from the current view.
          return scope !== scopeFilter
            ? updated.filter((m) => m.memoryId !== memoryId)
            : updated;
        });
      }
      return ok;
    },
    [scopeFilter],
  );

  return {
    memories,
    total,
    isLoading,
    error,
    search,
    setSearch,
    scopeFilter,
    setScopeFilter,
    sourceTypeFilter,
    setSourceTypeFilter,
    reload: () => void load(search, scopeFilter, sourceTypeFilter),
    remove,
    pin,
    correct,
    toggleScope,
  };
}

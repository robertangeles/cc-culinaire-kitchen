/**
 * @module useModelOptions
 *
 * Custom hooks for fetching AI model options from the model-options API.
 *
 * - `useModelOptions()` — returns enabled models only (for prompt dropdown).
 * - `useModelAdmin()` — returns all models + OpenRouter catalog (for admin).
 */

import { useState, useEffect, useCallback } from "react";

/** Shape of a model option returned by the API. */
export interface ModelOption {
  modelOptionId: number;
  modelId: string;
  displayName: string;
  provider: string;
  category: string;
  contextLength: number | null;
  inputCostPerM: string | null;
  outputCostPerM: string | null;
  sortOrder: number;
  enabledInd: boolean;
}

/** Shape of a model from the OpenRouter catalog (not yet enabled). */
export interface AvailableModel {
  modelId: string;
  displayName: string;
  provider: string;
  contextLength: number | null;
  inputCostPerM: string | null;
  outputCostPerM: string | null;
}

// ---------------------------------------------------------------------------
// useModelOptions — enabled models for prompt dropdown
// ---------------------------------------------------------------------------

interface UseModelOptionsReturn {
  models: ModelOption[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetches enabled models on mount. Used by prompt editor model dropdown.
 */
export function useModelOptions(): UseModelOptionsReturn {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/model-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load models");
      const data = await res.json();
      setModels(data.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { models, isLoading, error, refresh };
}

// ---------------------------------------------------------------------------
// useModelAdmin — all models + catalog for admin tab
// ---------------------------------------------------------------------------

interface UseModelAdminReturn {
  /** All models in DB (enabled + disabled). */
  allModels: ModelOption[];
  /** Full OpenRouter catalog (fetched on demand). */
  availableModels: AvailableModel[];
  isLoading: boolean;
  isFetchingCatalog: boolean;
  error: string | null;
  /** Refresh the DB model list. */
  refresh: () => Promise<void>;
  /** Fetch the OpenRouter catalog. */
  fetchCatalog: () => Promise<void>;
  /** Enable a model from the catalog. */
  enable: (model: AvailableModel) => Promise<void>;
  /** Disable a model by its DB ID. */
  disable: (modelOptionId: number) => Promise<void>;
  /** Update sort order. */
  updateSort: (modelOptionId: number, sortOrder: number) => Promise<void>;
}

export function useModelAdmin(): UseModelAdminReturn {
  const [allModels, setAllModels] = useState<ModelOption[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingCatalog, setIsFetchingCatalog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/model-options/all", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load models");
      const data = await res.json();
      setAllModels(data.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const fetchCatalog = useCallback(async () => {
    setIsFetchingCatalog(true);
    setError(null);
    try {
      const res = await fetch("/api/model-options/available", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch OpenRouter catalog");
      const data = await res.json();
      setAvailableModels(data.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch catalog");
    } finally {
      setIsFetchingCatalog(false);
    }
  }, []);

  const enable = useCallback(async (model: AvailableModel) => {
    const res = await fetch("/api/model-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        modelId: model.modelId,
        displayName: model.displayName,
        provider: model.provider,
        category: "chat",
        contextLength: model.contextLength,
        inputCostPerM: model.inputCostPerM,
        outputCostPerM: model.outputCostPerM,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Failed to enable model");
    }
    await refresh();
  }, [refresh]);

  const disable = useCallback(async (modelOptionId: number) => {
    const res = await fetch(`/api/model-options/${modelOptionId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to disable model");
    await refresh();
  }, [refresh]);

  const updateSort = useCallback(async (modelOptionId: number, sortOrder: number) => {
    await fetch(`/api/model-options/${modelOptionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ sortOrder }),
    });
    await refresh();
  }, [refresh]);

  return {
    allModels,
    availableModels,
    isLoading,
    isFetchingCatalog,
    error,
    refresh,
    fetchCatalog,
    enable,
    disable,
    updateSort,
  };
}

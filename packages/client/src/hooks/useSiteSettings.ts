/**
 * @module useSiteSettings
 *
 * Custom hook for fetching and updating site-wide settings via the
 * `/api/settings` REST endpoints. Provides loading state and an
 * optimistic update pattern for responsive UI.
 */

import { useState, useEffect, useCallback } from "react";
import { useSettings } from "../context/SettingsContext.js";

/** Shape returned by the {@link useSiteSettings} hook. */
interface UseSiteSettingsReturn {
  /** Current settings as a key-value map. */
  settings: Record<string, string>;
  /** True while settings are being fetched from the server. */
  isLoading: boolean;
  /** True while a save request is in flight. */
  isSaving: boolean;
  /** Most recent error message, or null. */
  error: string | null;
  /** Transient success message (auto-clears after 3 seconds), or null. */
  success: string | null;
  /** Update one or more settings. */
  save: (updates: Record<string, string>) => Promise<void>;
  /** Upload an image file and return its public path. */
  uploadFile: (file: File) => Promise<string | null>;
}

/**
 * Manages site settings: fetch on mount, save updates, upload files.
 *
 * @returns Settings state and actions — see {@link UseSiteSettingsReturn}.
 */
export function useSiteSettings(): UseSiteSettingsReturn {
  const { refresh: refreshGlobalSettings } = useSettings();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    fetch("/api/settings")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load settings");
        return res.json();
      })
      .then((data) => setSettings(data.settings))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  const save = useCallback(async (updates: Record<string, string>) => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      setSettings((prev) => ({ ...prev, ...updates }));
      await refreshGlobalSettings();
      setSuccess("Settings saved successfully");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }, [refreshGlobalSettings]);

  const uploadFile = useCallback(async (file: File): Promise<string | null> => {
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/settings/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      return data.path as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      return null;
    }
  }, []);

  return {
    settings,
    isLoading,
    isSaving,
    error,
    success,
    save,
    uploadFile,
  };
}

/**
 * @module usePrompt
 *
 * Custom hook for loading, editing, saving, and resetting a named prompt
 * via the /api/prompts REST endpoints. Tracks dirty state, loading/saving
 * progress, and transient success/error messages.
 */

import { useState, useEffect, useCallback } from "react";

/** Shape returned by the {@link usePrompt} hook. */
interface UsePromptReturn {
  /** Current prompt text (may include unsaved edits). */
  content: string;
  /** Update the in-memory prompt content without persisting. */
  setContent: (content: string) => void;
  /** True while the prompt is being fetched from the server. */
  isLoading: boolean;
  /** True while a save or reset request is in flight. */
  isSaving: boolean;
  /** True when the editor content differs from the last-saved value. */
  isDirty: boolean;
  /** Most recent error message, or null. */
  error: string | null;
  /** Transient success message (auto-clears after 3 seconds), or null. */
  success: string | null;
  /** Persist the current content to the server. */
  save: () => Promise<void>;
  /** Reset the prompt to its server-side default and reload the content. */
  reset: () => Promise<void>;
}

/**
 * Manages the full lifecycle of a single named prompt: fetch on mount,
 * local editing, save via PUT, and reset-to-default via POST.
 *
 * @param name - Prompt identifier used in the API path (e.g. "systemPrompt").
 * @returns Prompt state and actions — see {@link UsePromptReturn}.
 */
export function usePrompt(name: string): UsePromptReturn {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isDirty = content !== savedContent;

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    fetch(`/api/prompts/${name}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load prompt");
        return res.json();
      })
      .then((data) => {
        setContent(data.content);
        setSavedContent(data.content);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [name]);

  const save = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/prompts/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Failed to save prompt");
      setSavedContent(content);
      setSuccess("Prompt saved successfully");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }, [name, content]);

  const reset = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/prompts/${name}/reset`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to reset prompt");
      const data = await res.json();
      setContent(data.content);
      setSavedContent(data.content);
      setSuccess("Prompt reset to default");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setIsSaving(false);
    }
  }, [name]);

  return {
    content,
    setContent,
    isLoading,
    isSaving,
    isDirty,
    error,
    success,
    save,
    reset,
  };
}

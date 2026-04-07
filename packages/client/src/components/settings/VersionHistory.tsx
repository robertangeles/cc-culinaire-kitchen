/**
 * @module VersionHistory
 *
 * Slide-over panel that displays the version history for a prompt.
 * Each version entry shows its number, timestamp, and a truncated preview
 * of the prompt body. A "Restore" button rolls back the active prompt
 * to that version's content.
 */

import { useEffect, useCallback } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import {
  usePromptVersions,
  type PromptVersion,
} from "../../hooks/usePromptVersions.js";
import {
  X,
  History,
  Loader2,
  AlertCircle,
  RotateCcw,
  Bot,
} from "lucide-react";

/** Props for {@link VersionHistory}. */
interface VersionHistoryProps {
  /** Prompt identifier (e.g. `"systemPrompt"`). */
  promptName: string;
  /** Called when the panel should close. */
  onClose: () => void;
  /** Called after a successful rollback with the restored content. */
  onRollback: (content: string) => void;
}

/**
 * Formats an ISO timestamp into a human-readable date/time string.
 *
 * @param iso - ISO 8601 timestamp string.
 * @returns Formatted string like "Mar 9, 2026, 3:45 PM".
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Renders a slide-over panel listing all saved versions of a prompt.
 * Fetches version history on mount and provides rollback functionality.
 */
export function VersionHistory({
  promptName,
  onClose,
  onRollback,
}: VersionHistoryProps) {
  const {
    versions,
    isLoading,
    isRollingBack,
    error,
    fetchVersions,
    rollback,
  } = usePromptVersions(promptName);

  const trapRef = useFocusTrap<HTMLDivElement>();

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  /** Handle restoring a version and notifying the parent. */
  async function handleRollback(version: PromptVersion) {
    const content = await rollback(version.versionId);
    if (content !== null) {
      onRollback(content);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" ref={trapRef} role="dialog" aria-modal="true" aria-label="Version History">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-[#161616] shadow-2xl shadow-black/40 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2A2A]">
          <div className="flex items-center gap-2">
            <History className="size-5 text-[#E5E5E5]" />
            <h2 className="text-lg font-semibold text-[#FAFAFA]">
              Version History
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#999999] hover:text-[#E5E5E5] transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-[#999999]">
              <Loader2 className="size-5 animate-spin mr-2" />
              Loading versions...
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 py-4">
              <AlertCircle className="size-4" />
              {error}
            </div>
          )}

          {!isLoading && !error && versions.length === 0 && (
            <p className="text-sm text-[#999999] py-12 text-center">
              No version history yet. Versions are created each time you
              save the prompt.
            </p>
          )}

          {!isLoading && versions.length > 0 && (
            <div className="space-y-3">
              {versions.map((version) => (
                <div
                  key={version.versionId}
                  className="border border-[#2A2A2A] rounded-lg p-4 hover:border-[#2A2A2A] transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[#E5E5E5]">
                      Version {version.versionNumber}
                    </span>
                    <span className="text-xs text-[#999999]">
                      {formatDate(version.createdDttm)}
                    </span>
                  </div>
                  {version.modelId && (
                    <div className="flex items-center gap-1 text-[10px] text-[#D4A574] mb-1.5">
                      <Bot className="size-3" />
                      {version.modelId}
                    </div>
                  )}
                  <p className="text-xs text-[#999999] line-clamp-3 font-mono mb-3">
                    {version.promptBody}
                  </p>
                  <button
                    onClick={() => handleRollback(version)}
                    disabled={isRollingBack}
                    className="flex items-center gap-1.5 text-xs text-[#D4A574] hover:text-[#D4A574] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isRollingBack ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3" />
                    )}
                    Restore this version
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

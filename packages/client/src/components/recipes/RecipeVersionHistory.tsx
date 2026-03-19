/**
 * @module components/recipes/RecipeVersionHistory
 *
 * Slide-in panel showing recipe version timeline.
 * Allows previewing past versions and reverting to them.
 */

import { useState, useEffect, useCallback } from "react";
import { X, Clock, Loader2, Eye, RotateCcw, AlertTriangle } from "lucide-react";

interface VersionSummary {
  versionId: string;
  versionNumber: number;
  changeDescription: string | null;
  changeType: string;
  createdDttm: string;
}

interface VersionDetail {
  versionId: string;
  versionNumber: number;
  recipeData: unknown;
  changeDescription: string | null;
  changeType: string;
  createdDttm: string;
}

interface RecipeVersionHistoryProps {
  recipeId: string;
  onRevert: (recipeData: unknown) => void;
  onClose: () => void;
}

const CHANGE_TYPE_BADGES: Record<string, string> = {
  Original: "bg-[#2A2A2A] text-[#999999]",
  Manual: "bg-blue-500/20 text-blue-400",
  AI: "bg-purple-500/20 text-purple-400",
  Revert: "bg-amber-500/20 text-amber-400",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RecipeVersionHistory({
  recipeId,
  onRevert,
  onClose,
}: RecipeVersionHistoryProps) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [previewVersion, setPreviewVersion] = useState<VersionDetail | null>(
    null,
  );
  const [previewLoading, setPreviewLoading] = useState(false);

  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);

  /* ---------- fetch versions ---------- */

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/recipes/${recipeId}/versions`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Failed to load versions (${res.status})`);
        const data = (await res.json()) as { versions: VersionSummary[] };
        if (!cancelled) setVersions(data.versions ?? []);
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Failed to load versions",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  /* ---------- preview ---------- */

  const handlePreview = useCallback(
    async (versionId: string) => {
      if (previewVersion?.versionId === versionId) {
        setPreviewVersion(null);
        return;
      }
      setPreviewLoading(true);
      try {
        const res = await fetch(
          `/api/recipes/${recipeId}/versions/${versionId}`,
          { credentials: "include" },
        );
        if (!res.ok)
          throw new Error(`Failed to load version (${res.status})`);
        const data = (await res.json()) as { version: VersionDetail };
        setPreviewVersion(data.version);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load version",
        );
      } finally {
        setPreviewLoading(false);
      }
    },
    [recipeId, previewVersion],
  );

  /* ---------- revert ---------- */

  const handleRevert = useCallback(
    async (versionId: string) => {
      setRevertingId(versionId);
      setError(null);

      try {
        const res = await fetch(
          `/api/recipes/${recipeId}/versions/${versionId}/revert`,
          {
            method: "POST",
            credentials: "include",
          },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string }).error ??
              `Revert failed (${res.status})`,
          );
        }
        const data = (await res.json()) as { recipe: { recipeData: unknown } };
        onRevert(data.recipe?.recipeData ?? data.recipe);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Revert failed");
      } finally {
        setRevertingId(null);
        setConfirmRevertId(null);
      }
    },
    [recipeId, onRevert],
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <div className="bg-[#161616] rounded-l-2xl border-l border-t border-b border-[#2A2A2A] max-w-md w-full p-6 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-[#D4A574]/10 flex items-center justify-center">
              <Clock className="size-5 text-[#D4A574]" />
            </div>
            <h2 className="text-xl font-semibold text-[#FAFAFA]">
              Version History
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#666666] hover:text-white transition-colors p-1"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="size-8 animate-spin text-[#D4A574]" />
            <p className="text-sm text-[#999999]">Loading versions...</p>
          </div>
        )}

        {/* Empty */}
        {!loading && versions.length === 0 && !error && (
          <p className="text-sm text-[#666666] text-center py-8">
            No version history found.
          </p>
        )}

        {/* Timeline */}
        {!loading && versions.length > 0 && (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-[#2A2A2A]" />

            <div className="space-y-6">
              {versions.map((v) => (
                <div key={v.versionId} className="relative pl-8">
                  {/* Timeline dot */}
                  <div className="absolute left-0 top-1.5 size-6 rounded-full bg-[#D4A574] flex items-center justify-center">
                    <span className="text-[10px] font-bold text-[#0A0A0A]">
                      {v.versionNumber}
                    </span>
                  </div>

                  <div className="bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-[#FAFAFA]">
                        Version {v.versionNumber}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          CHANGE_TYPE_BADGES[v.changeType] ??
                          CHANGE_TYPE_BADGES.Original
                        }`}
                      >
                        {v.changeType}
                      </span>
                    </div>

                    <p className="text-xs text-[#666666] mb-2">
                      {formatDate(v.createdDttm)}
                    </p>

                    {v.changeDescription && (
                      <p className="text-xs text-[#999999] mb-3 leading-relaxed">
                        {v.changeDescription}
                      </p>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePreview(v.versionId)}
                        disabled={previewLoading}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#D4A574] border border-[#D4A574]/30 hover:border-[#D4A574]/60 hover:bg-[#D4A574]/10 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {previewLoading &&
                        previewVersion?.versionId !== v.versionId ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Eye className="size-3" />
                        )}
                        {previewVersion?.versionId === v.versionId
                          ? "Hide"
                          : "Preview"}
                      </button>

                      {v.versionNumber > 0 && (
                        <>
                          {confirmRevertId === v.versionId ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleRevert(v.versionId)}
                                disabled={revertingId === v.versionId}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {revertingId === v.versionId ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <AlertTriangle className="size-3" />
                                )}
                                Confirm
                              </button>
                              <button
                                onClick={() => setConfirmRevertId(null)}
                                className="px-2 py-1.5 text-xs text-[#666666] hover:text-white transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmRevertId(v.versionId)}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#999999] hover:text-white border border-[#2A2A2A] hover:border-[#444444] rounded-lg transition-colors"
                            >
                              <RotateCcw className="size-3" />
                              Revert
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    {/* Preview area */}
                    {previewVersion?.versionId === v.versionId && (
                      <div className="mt-3 pt-3 border-t border-[#2A2A2A]">
                        <pre className="text-xs text-[#999999] whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                          {JSON.stringify(previewVersion.recipeData, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

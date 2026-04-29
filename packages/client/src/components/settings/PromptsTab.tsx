/**
 * @module PromptsTab
 *
 * Settings tab for managing all system prompts. Displays a selectable
 * prompt list on the left and a full-height editor on the right. Supports
 * creating new prompts, editing existing ones, saving, resetting to
 * defaults, and viewing/rolling back version history.
 */

import { useState, type FormEvent } from "react";
import { usePromptList, type PromptSummary } from "../../hooks/usePromptList.js";
import { usePrompt } from "../../hooks/usePrompt.js";
import { VersionHistory } from "./VersionHistory.js";
import { useModelOptions } from "../../hooks/useModelOptions.js";
import { ModelSelector } from "./ModelSelector.js";
import { OnDeviceRuntimeBanner } from "./OnDeviceRuntimeBanner.js";
import {
  Save,
  RotateCcw,
  Loader2,
  AlertCircle,
  Check,
  History,
  Plus,
  FileText,
  X,
  Bot,
  Smartphone,
  Server,
} from "lucide-react";

/**
 * Renders the multi-prompt management interface within the Settings page.
 * Left sidebar lists all prompts; right panel shows the editor for the
 * selected prompt.
 */
export function PromptsTab() {
  const { prompts, isLoading: listLoading, error: listError, refresh, create } = usePromptList();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Auto-select first prompt once loaded
  const activeName = selectedName ?? (prompts.length > 0 ? prompts[0].promptName : null);

  return (
    <div className="flex h-full">
      {/* Left sidebar — prompt list */}
      <div className="w-64 flex-shrink-0 border-r border-[#2A2A2A] flex flex-col">
        <div className="px-4 py-4 border-b border-[#2A2A2A] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#E5E5E5] uppercase tracking-wider">
            Prompts
          </h2>
          <button
            onClick={() => setShowCreate(true)}
            className="p-1 text-[#999999] hover:text-[#D4A574] hover:bg-[#D4A574]/10 rounded transition-colors"
            title="New Prompt"
          >
            <Plus className="size-4" />
          </button>
        </div>

        {listLoading ? (
          <div className="flex items-center justify-center py-8 text-[#999999]">
            <Loader2 className="size-4 animate-spin mr-2" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : listError ? (
          <div className="px-4 py-3 text-sm text-red-400">
            <AlertCircle className="size-4 inline mr-1" />
            {listError}
          </div>
        ) : (
          <div role="tablist" aria-label="Prompts" aria-orientation="vertical" className="flex-1 overflow-y-auto py-2">
            {prompts.map((p) => (
              <PromptListItem
                key={p.promptId}
                prompt={p}
                isActive={p.promptName === activeName}
                onClick={() => setSelectedName(p.promptName)}
              />
            ))}
            {prompts.length === 0 && (
              <p className="px-4 py-8 text-sm text-[#999999] text-center">
                No prompts found
              </p>
            )}
          </div>
        )}
      </div>

      {/* Right panel — editor */}
      <div className="flex-1 min-w-0 flex flex-col">
        {showCreate ? (
          <CreatePromptForm
            onCreated={(name) => {
              setSelectedName(name);
              setShowCreate(false);
              refresh();
            }}
            onCancel={() => setShowCreate(false)}
            create={create}
          />
        ) : activeName ? (
          <PromptEditor name={activeName} />
        ) : (
          <div className="flex items-center justify-center h-full text-[#999999] text-sm">
            <FileText className="size-5 mr-2" />
            Select a prompt to edit
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prompt list item
// ---------------------------------------------------------------------------

/** Props for {@link PromptListItem}. */
interface PromptListItemProps {
  prompt: PromptSummary;
  isActive: boolean;
  onClick: () => void;
}

/**
 * Single item in the prompt sidebar list. Shows the prompt name and
 * machine-readable key. Highlights when selected.
 */
function PromptListItem({ prompt, isActive, onClick }: PromptListItemProps) {
  return (
    <button
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={`w-full text-left px-4 py-2.5 transition-colors ${
        isActive
          ? "bg-[#D4A574]/10 border-r-2 border-[#D4A574] text-[#FAFAFA]"
          : "text-[#E5E5E5] hover:bg-[#0A0A0A] hover:text-[#FAFAFA]"
      }`}
    >
      <span className="block text-sm font-medium truncate">{prompt.promptName}</span>
      {prompt.promptKey && (
        <span className="block text-xs text-[#999999] truncate">{prompt.promptKey}</span>
      )}
      {prompt.modelId && (
        <span className="flex items-center gap-1 text-[10px] text-[#D4A574] mt-0.5">
          <Bot className="size-3" />
          {prompt.modelId.split("/")[1] ?? prompt.modelId}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Prompt editor (right panel)
// ---------------------------------------------------------------------------

/** Props for {@link PromptEditor}. */
interface PromptEditorProps {
  /** Prompt name to load and edit. */
  name: string;
}

/**
 * Full-height prompt editor with save, reset, and version history controls.
 * Uses the {@link usePrompt} hook for CRUD against the API.
 */
function PromptEditor({ name }: PromptEditorProps) {
  const {
    content,
    setContent,
    modelId,
    setModelId,
    runtime,
    changeRuntime,
    isLoading,
    isSaving,
    isDirty,
    error,
    success,
    save,
    reset,
  } = usePrompt(name);

  const { models: availableModels } = useModelOptions();
  const [showVersions, setShowVersions] = useState(false);
  const [pendingRuntime, setPendingRuntime] = useState<"server" | "device" | null>(null);

  /** Called when a version is restored from the VersionHistory panel. */
  function handleRollback(restoredContent: string) {
    setContent(restoredContent);
    setShowVersions(false);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-[#999999]">
        <Loader2 className="size-5 animate-spin mr-2" />
        Loading prompt...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-6 border-b border-[#2A2A2A]">
        <h1 className="text-xl font-semibold text-[#FAFAFA]">{name}</h1>
        <p className="mt-1 text-sm text-[#999999]">
          Edit the prompt content below. Changes are saved with version history.
        </p>
      </div>

      {/* Runtime-aware AI model section. Server-runtime prompts get the
          existing OpenRouter model dropdown. Device-runtime prompts get a
          read-only banner — the server cannot invoke a model for them, so
          a dropdown would be misleading. A "Switch runtime" button on
          either side opens a confirmation modal before flipping. */}
      <div className="px-8 py-3 border-b border-[#2A2A2A]">
        {runtime === "device" ? (
          <div className="space-y-2 max-w-md">
            <OnDeviceRuntimeBanner />
            <button
              type="button"
              onClick={() => setPendingRuntime("server")}
              disabled={isSaving}
              className="text-xs text-[#999999] hover:text-[#D4A574] underline-offset-2 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Switch to Server runtime…
            </button>
          </div>
        ) : (
          <>
            <label className="block text-sm font-medium text-[#E5E5E5] mb-1">
              AI Model
            </label>
            <p className="text-xs text-[#999999] mb-2">
              Override which model this prompt uses. &ldquo;Global Default&rdquo; uses the system-wide model.
            </p>
            <ModelSelector
              value={modelId}
              onChange={setModelId}
              models={availableModels}
              className="max-w-md"
            />
            <button
              type="button"
              onClick={() => setPendingRuntime("device")}
              disabled={isSaving}
              className="mt-2 text-xs text-[#999999] hover:text-[#D4A574] underline-offset-2 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Switch to On-Device runtime…
            </button>
          </>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 px-8 py-4 min-h-0">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full h-full resize-none rounded-lg border border-[#2A2A2A] bg-[#161616] px-4 py-3 font-mono text-sm text-[#FAFAFA] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
          placeholder="Enter prompt content..."
          spellCheck={false}
        />
      </div>

      {/* Bottom bar */}
      <div className="px-8 py-4 border-t border-[#2A2A2A] bg-[#0A0A0A] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={reset}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 text-sm text-[#E5E5E5] bg-[#161616] border border-[#2A2A2A] rounded-lg hover:bg-[#0A0A0A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RotateCcw className="size-4" />
            Reset to Default
          </button>
          <button
            onClick={() => setShowVersions(true)}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 text-sm text-[#E5E5E5] bg-[#161616] border border-[#2A2A2A] rounded-lg hover:bg-[#0A0A0A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <History className="size-4" />
            Version History
          </button>
          {isDirty && (
            <span className="text-xs text-[#D4A574] font-medium">
              Unsaved changes
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {error && (
            <span className="flex items-center gap-1.5 text-sm text-red-400">
              <AlertCircle className="size-4" />
              {error}
            </span>
          )}
          {success && (
            <span className="flex items-center gap-1.5 text-sm text-green-400">
              <Check className="size-4" />
              {success}
            </span>
          )}

          <button
            onClick={save}
            disabled={isSaving || !isDirty}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save
          </button>
        </div>
      </div>

      {/* Version History slide-over */}
      {showVersions && (
        <VersionHistory
          promptName={name}
          onClose={() => setShowVersions(false)}
          onRollback={handleRollback}
        />
      )}

      {/* Runtime-change confirmation. Names the consequences explicitly
          so the admin doesn't flip blindly. */}
      {pendingRuntime && (
        <RuntimeChangeConfirm
          currentRuntime={runtime}
          targetRuntime={pendingRuntime}
          isSaving={isSaving}
          onCancel={() => setPendingRuntime(null)}
          onConfirm={async () => {
            await changeRuntime(pendingRuntime);
            setPendingRuntime(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runtime-change confirmation modal
// ---------------------------------------------------------------------------

interface RuntimeChangeConfirmProps {
  currentRuntime: "server" | "device";
  targetRuntime: "server" | "device";
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Modal that confirms a runtime flip and explicitly names the consequences.
 * The two flip directions have asymmetric blast radii — server→device
 * silences server callers loudly (502 from the runtime guard), while
 * device→server breaks mobile fetches (404 until the mobile cache busts).
 * Naming both prevents the admin from flipping without context.
 */
function RuntimeChangeConfirm({
  currentRuntime,
  targetRuntime,
  isSaving,
  onCancel,
  onConfirm,
}: RuntimeChangeConfirmProps) {
  const consequences =
    targetRuntime === "device"
      ? [
          "Any server code that calls this prompt (chat, recipe gen, refinement, etc.) will start returning 502 errors.",
          "The current model override will be cleared.",
          "Mobile clients (with a valid JWT) will be able to fetch the body via the mobile prompt-fetch route.",
        ]
      : [
          "Mobile clients fetching this prompt will start receiving 404 until they refresh their cache.",
          "Server code may immediately try to invoke this prompt with the global default model.",
          "Make sure a model is appropriate before flipping — you can pick one in the dropdown after the switch.",
        ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-[#161616] rounded-2xl border border-[#2A2A2A] shadow-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-[#2A2A2A]">
          <h2 className="text-lg font-semibold text-[#FAFAFA]">
            Switch runtime: {currentRuntime} → {targetRuntime}
          </h2>
          <p className="mt-1 text-sm text-[#999999]">
            This change is reversible but takes effect immediately.
          </p>
        </div>
        <div className="px-6 py-4 space-y-2">
          <p className="text-sm font-medium text-[#E5E5E5]">Consequences:</p>
          <ul className="space-y-1.5 text-sm text-[#999999]">
            {consequences.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="text-[#D4A574] flex-shrink-0">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-6 py-4 border-t border-[#2A2A2A] bg-[#0A0A0A] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="px-4 py-2 text-sm text-[#E5E5E5] hover:text-[#FAFAFA] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            Switch to {targetRuntime}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create prompt form
// ---------------------------------------------------------------------------

/** Props for {@link CreatePromptForm}. */
interface CreatePromptFormProps {
  onCreated: (name: string) => void;
  onCancel: () => void;
  create: (
    name: string,
    content: string,
    modelId?: string | null,
    runtime?: "server" | "device",
  ) => Promise<PromptSummary>;
}

/**
 * Inline form for creating a new prompt. Shows name input, auto-generated
 * key preview, runtime selector, and a content textarea.
 */
function CreatePromptForm({ onCreated, onCancel, create }: CreatePromptFormProps) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [newModelId, setNewModelId] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<"server" | "device">("server");
  const { models: availableModels } = useModelOptions();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  /** Auto-generate the prompt key from the name for preview. */
  const previewKey = name
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsCreating(true);
    setError("");
    try {
      await create(name.trim(), content, runtime === "device" ? null : newModelId, runtime);
      onCreated(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create prompt");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 py-6 border-b border-[#2A2A2A] flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#FAFAFA]">New Prompt</h1>
          <p className="mt-1 text-sm text-[#999999]">
            Create a new prompt template for the AI chatbot.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="p-1 text-[#999999] hover:text-[#E5E5E5] transition-colors"
        >
          <X className="size-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
        <div className="px-8 py-4 space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2">
              <AlertCircle className="size-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[#E5E5E5] mb-1">
              Prompt Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Technique Guide"
              className="w-full rounded-lg border border-[#2A2A2A] px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
              autoFocus
            />
            {previewKey && (
              <p className="mt-1 text-xs text-[#999999]">
                Key: <code className="bg-[#1E1E1E] px-1 rounded">{previewKey}</code>
              </p>
            )}
          </div>

          {/* Runtime selector — fixed at creation time, cannot be edited later */}
          <div>
            <label className="block text-sm font-medium text-[#E5E5E5] mb-2">
              Where does this prompt run?
            </label>
            <div className="grid grid-cols-2 gap-2 max-w-md">
              <button
                type="button"
                onClick={() => setRuntime("server")}
                className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                  runtime === "server"
                    ? "border-[#D4A574] bg-[#D4A574]/10 text-[#FAFAFA]"
                    : "border-[#2A2A2A] text-[#E5E5E5] hover:border-[#3A3A3A]"
                }`}
              >
                <Server className="size-4 mt-0.5 flex-shrink-0" />
                <span className="text-sm leading-tight">
                  <span className="block font-medium">Server</span>
                  <span className="block text-xs text-[#999999]">
                    Invoked via OpenRouter (default)
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setRuntime("device")}
                className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                  runtime === "device"
                    ? "border-[#D4A574] bg-[#D4A574]/10 text-[#FAFAFA]"
                    : "border-[#2A2A2A] text-[#E5E5E5] hover:border-[#3A3A3A]"
                }`}
              >
                <Smartphone className="size-4 mt-0.5 flex-shrink-0" />
                <span className="text-sm leading-tight">
                  <span className="block font-medium">On-Device (mobile)</span>
                  <span className="block text-xs text-[#999999]">
                    Runs locally on the user&apos;s device
                  </span>
                </span>
              </button>
            </div>
            <p className="mt-1.5 text-xs text-[#999999]">
              Cannot be changed after creation.
            </p>
          </div>

          {/* Model selector — only meaningful for server-runtime prompts */}
          {runtime === "server" ? (
            <div>
              <label className="block text-sm font-medium text-[#E5E5E5] mb-1">
                AI Model <span className="text-[#999999] font-normal">(optional)</span>
              </label>
              <ModelSelector
                value={newModelId}
                onChange={setNewModelId}
                models={availableModels}
                className="max-w-md"
              />
            </div>
          ) : (
            <OnDeviceRuntimeBanner />
          )}
        </div>

        <div className="flex-1 px-8 pb-4 min-h-0">
          <label className="block text-sm font-medium text-[#E5E5E5] mb-1">
            Prompt Content
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            placeholder="Enter the prompt content..."
            className="w-full h-[calc(100%-24px)] resize-none rounded-lg border border-[#2A2A2A] bg-[#161616] px-4 py-3 font-mono text-sm text-[#FAFAFA] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
            spellCheck={false}
          />
        </div>

        <div className="px-8 py-4 border-t border-[#2A2A2A] bg-[#0A0A0A] flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-[#E5E5E5] hover:text-[#FAFAFA] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isCreating || !name.trim() || !content.trim()}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isCreating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Create Prompt
          </button>
        </div>
      </form>
    </div>
  );
}

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

      {/* Model selector */}
      <div className="px-8 py-3 border-b border-[#2A2A2A]">
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
  create: (name: string, content: string, modelId?: string | null) => Promise<PromptSummary>;
}

/**
 * Inline form for creating a new prompt. Shows name input, auto-generated
 * key preview, and a content textarea.
 */
function CreatePromptForm({ onCreated, onCancel, create }: CreatePromptFormProps) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [newModelId, setNewModelId] = useState<string | null>(null);
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
      await create(name.trim(), content, newModelId);
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

          {/* Model selector */}
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

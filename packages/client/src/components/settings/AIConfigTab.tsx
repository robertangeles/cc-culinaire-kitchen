/**
 * @module AIConfigTab
 *
 * Settings tab for AI configuration. Contains two sub-tabs:
 *
 * 1. **AI Features** — toggles for web search, image generation, and
 *    vector search (migrated from SiteSettingsTab).
 * 2. **Model Registry** — browse, enable, disable, and reorder AI models
 *    sourced from OpenRouter, with token pricing.
 */

import { useState, useEffect, useRef } from "react";
import { useSiteSettings } from "../../hooks/useSiteSettings.js";
import {
  useModelOptions,
  useModelAdmin,
  type ModelOption,
  type AvailableModel,
} from "../../hooks/useModelOptions.js";
import { ModelSelector } from "./ModelSelector.js";
import {
  Bot,
  Zap,
  Save,
  Loader2,
  AlertCircle,
  Check,
  Search,
  Plus,
  X,
  ChevronUp,
  ChevronDown,
  Globe,
  Image,
  Database,
} from "lucide-react";

type SubTab = "features" | "registry";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AIConfigTab() {
  const [subTab, setSubTab] = useState<SubTab>("features");

  return (
    <div className="flex flex-col h-full">
      {/* Header with sub-tab navigation */}
      <div className="px-8 py-6 border-b border-[#2A2A2A]">
        <h1 className="text-xl font-semibold text-[#FAFAFA]">AI Configuration</h1>
        <p className="mt-1 text-sm text-[#999999]">
          Manage AI features and the model registry.
        </p>

        {/* Sub-tabs */}
        <div className="flex gap-1 mt-4 bg-[#161616] rounded-lg p-1 w-fit">
          <button
            onClick={() => setSubTab("features")}
            className={`flex items-center gap-2 px-4 py-2 text-sm rounded-md transition-colors ${
              subTab === "features"
                ? "bg-[#2A2A2A] text-[#FAFAFA] shadow-sm"
                : "text-[#999999] hover:text-[#E5E5E5]"
            }`}
          >
            <Zap className="size-4" />
            AI Features
          </button>
          <button
            onClick={() => setSubTab("registry")}
            className={`flex items-center gap-2 px-4 py-2 text-sm rounded-md transition-colors ${
              subTab === "registry"
                ? "bg-[#2A2A2A] text-[#FAFAFA] shadow-sm"
                : "text-[#999999] hover:text-[#E5E5E5]"
            }`}
          >
            <Bot className="size-4" />
            Model Registry
          </button>
        </div>
      </div>

      {/* Sub-tab content */}
      {subTab === "features" ? <AIFeaturesPanel /> : <ModelRegistryPanel />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-tab 1: AI Features (migrated from SiteSettingsTab)
// ---------------------------------------------------------------------------

export function AIFeaturesPanel() {
  const {
    settings,
    isLoading,
    isSaving,
    error,
    success,
    save,
  } = useSiteSettings();

  const { models: enabledModels } = useModelOptions();

  const [form, setForm] = useState({
    web_search_enabled: "false",
    web_search_model: "perplexity/sonar-pro",
    image_generation_enabled: "false",
    image_generation_model: "google/gemini-2.5-flash-image",
    vector_search_enabled: "false",
  });

  const initialized = useRef(false);

  useEffect(() => {
    if (!isLoading && !initialized.current) {
      setForm({
        web_search_enabled: settings.web_search_enabled ?? "false",
        web_search_model: settings.web_search_model ?? "perplexity/sonar-pro",
        image_generation_enabled: settings.image_generation_enabled ?? "false",
        image_generation_model: settings.image_generation_model ?? "google/gemini-2.5-flash-image",
        vector_search_enabled: settings.vector_search_enabled ?? "false",
      });
      initialized.current = true;
    }
  }, [isLoading, settings]);

  function updateField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    await save(form);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-[#999999]">
        <Loader2 className="size-5 animate-spin mr-2" />
        Loading settings...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-3">
        {/* Web Search Toggle */}
        <div className="flex items-center justify-between rounded-lg border border-[#2A2A2A] bg-[#161616] px-4 py-3">
          <div className="flex items-center gap-3">
            <Globe className="size-5 text-[#D4A574]" />
            <div>
              <div className="text-sm font-medium text-[#FAFAFA]">
                Enable Web Search
              </div>
              <p className="text-xs text-[#999999] mt-0.5">
                Allow the AI assistant to search the web for current information
                beyond the curated knowledge base. Uses a web-search-capable model via OpenRouter.
              </p>
            </div>
          </div>
          <ToggleSwitch
            checked={form.web_search_enabled === "true"}
            onChange={(v) => updateField("web_search_enabled", v ? "true" : "false")}
          />
        </div>

        {/* Web Search Model Selector */}
        {form.web_search_enabled === "true" && (
          <div className="rounded-lg border border-[#2A2A2A] bg-[#161616] px-4 py-3 ml-8">
            <label className="block text-sm font-medium text-[#FAFAFA] mb-1">
              Web Search Model
            </label>
            <p className="text-xs text-[#999999] mb-2">
              Select the model used for web search requests.
            </p>
            <ModelSelector
              value={form.web_search_model}
              onChange={(id) => updateField("web_search_model", id ?? "perplexity/sonar-pro")}
              models={enabledModels}
              required
            />
          </div>
        )}

        {/* Image Generation Toggle */}
        <div className="flex items-center justify-between rounded-lg border border-[#2A2A2A] bg-[#161616] px-4 py-3">
          <div className="flex items-center gap-3">
            <Image className="size-5 text-[#D4A574]" />
            <div>
              <div className="text-sm font-medium text-[#FAFAFA]">
                Enable Image Generation
              </div>
              <p className="text-xs text-[#999999] mt-0.5">
                Allow users to generate images using AI models via OpenRouter.
                Requires OPENROUTER_API_KEY to be configured.
              </p>
            </div>
          </div>
          <ToggleSwitch
            checked={form.image_generation_enabled === "true"}
            onChange={(v) => updateField("image_generation_enabled", v ? "true" : "false")}
          />
        </div>

        {/* Image Generation Model Selector */}
        {form.image_generation_enabled === "true" && (
          <div className="rounded-lg border border-[#2A2A2A] bg-[#161616] px-4 py-3 ml-8">
            <label className="block text-sm font-medium text-[#FAFAFA] mb-1">
              Image Generation Model
            </label>
            <p className="text-xs text-[#999999] mb-2">
              Select the model used for image generation.
            </p>
            <ModelSelector
              value={form.image_generation_model}
              onChange={(id) => updateField("image_generation_model", id ?? "google/gemini-2.5-flash-image")}
              models={enabledModels}
              required
            />
          </div>
        )}

        {/* Vector Search Toggle */}
        <div className="flex items-center justify-between rounded-lg border border-[#2A2A2A] bg-[#161616] px-4 py-3">
          <div className="flex items-center gap-3">
            <Database className="size-5 text-[#D4A574]" />
            <div>
              <div className="text-sm font-medium text-[#FAFAFA]">
                Enable Semantic Vector Search
              </div>
              <p className="text-xs text-[#999999] mt-0.5">
                Use AI embeddings for semantic knowledge search instead of keyword matching.
                Requires pgvector on your PostgreSQL instance and an OpenRouter API key.
                Falls back to keyword search when disabled.
              </p>
            </div>
          </div>
          <ToggleSwitch
            checked={form.vector_search_enabled === "true"}
            onChange={(v) => updateField("vector_search_enabled", v ? "true" : "false")}
          />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="px-8 py-4 border-t border-[#2A2A2A] bg-[#0A0A0A] flex items-center justify-end gap-3">
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
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-tab 2: Model Registry
// ---------------------------------------------------------------------------

export function ModelRegistryPanel() {
  const {
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
  } = useModelAdmin();

  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  async function handleBrowse() {
    setShowCatalog(true);
    if (availableModels.length === 0) {
      await fetchCatalog();
    }
  }

  async function handleEnable(model: AvailableModel) {
    setActionError(null);
    try {
      await enable(model);
      setActionSuccess(`${model.displayName} enabled`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to enable model");
    }
  }

  async function handleDisable(m: ModelOption) {
    setActionError(null);
    try {
      await disable(m.modelOptionId);
      setActionSuccess(`${m.displayName} disabled`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to disable model");
    }
  }

  async function handleMoveUp(m: ModelOption, index: number) {
    if (index <= 0) return;
    const prev = allModels.filter((x) => x.enabledInd)[index - 1];
    await updateSort(m.modelOptionId, prev.sortOrder);
    await updateSort(prev.modelOptionId, m.sortOrder);
  }

  async function handleMoveDown(m: ModelOption, index: number) {
    const enabled = allModels.filter((x) => x.enabledInd);
    if (index >= enabled.length - 1) return;
    const next = enabled[index + 1];
    await updateSort(m.modelOptionId, next.sortOrder);
    await updateSort(next.modelOptionId, m.sortOrder);
  }

  // Filter catalog: exclude already-enabled models, apply search + provider filter
  const enabledIds = new Set(allModels.map((m) => m.modelId));
  const filteredCatalog = availableModels.filter((m) => {
    if (enabledIds.has(m.modelId)) return false;
    if (providerFilter && m.provider !== providerFilter) return false;
    if (catalogSearch) {
      const q = catalogSearch.toLowerCase();
      return (
        m.modelId.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Unique providers from catalog
  const providers = [...new Set(availableModels.map((m) => m.provider))].sort();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-[#999999]">
        <Loader2 className="size-5 animate-spin mr-2" />
        Loading models...
      </div>
    );
  }

  const enabledModels = allModels.filter((m) => m.enabledInd);
  const disabledModels = allModels.filter((m) => !m.enabledInd);

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
      {/* Status messages */}
      {(error || actionError) && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2">
          <AlertCircle className="size-4 flex-shrink-0" />
          {error || actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="flex items-center gap-2 text-sm text-green-400 bg-green-900/30 border border-green-700/40 rounded-lg px-3 py-2">
          <Check className="size-4 flex-shrink-0" />
          {actionSuccess}
        </div>
      )}

      {/* Enabled Models */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#FAFAFA] uppercase tracking-wider">
            Enabled Models ({enabledModels.length})
          </h2>
          <button
            onClick={handleBrowse}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[#D4A574] bg-[#D4A574]/10 rounded-lg hover:bg-[#D4A574]/20 transition-colors"
          >
            <Plus className="size-3.5" />
            Browse OpenRouter
          </button>
        </div>

        {enabledModels.length === 0 ? (
          <div className="rounded-lg border border-[#2A2A2A] bg-[#161616] px-6 py-8 text-center text-sm text-[#999999]">
            No models enabled yet. Browse the OpenRouter catalog to add models.
          </div>
        ) : (
          <div className="space-y-2">
            {enabledModels.map((m, i) => (
              <ModelCard
                key={m.modelOptionId}
                model={m}
                onDisable={() => handleDisable(m)}
                onMoveUp={() => handleMoveUp(m, i)}
                onMoveDown={() => handleMoveDown(m, i)}
                isFirst={i === 0}
                isLast={i === enabledModels.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      {/* Disabled Models */}
      {disabledModels.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[#666666] uppercase tracking-wider mb-3">
            Disabled ({disabledModels.length})
          </h2>
          <div className="space-y-2">
            {disabledModels.map((m) => (
              <div
                key={m.modelOptionId}
                className="flex items-center justify-between rounded-lg border border-[#2A2A2A]/50 bg-[#161616]/50 px-4 py-3 opacity-60"
              >
                <div>
                  <div className="text-sm text-[#999999]">{m.displayName}</div>
                  <div className="text-xs text-[#666666]">{m.modelId}</div>
                </div>
                <button
                  onClick={() => handleEnable({
                    modelId: m.modelId,
                    displayName: m.displayName,
                    provider: m.provider,
                    contextLength: m.contextLength,
                    inputCostPerM: m.inputCostPerM,
                    outputCostPerM: m.outputCostPerM,
                  })}
                  className="text-xs text-[#D4A574] hover:text-[#FAFAFA] transition-colors"
                >
                  Re-enable
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Browse OpenRouter Catalog (expandable) */}
      {showCatalog && (
        <div className="border-t border-[#2A2A2A] pt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[#FAFAFA] uppercase tracking-wider">
              OpenRouter Catalog
            </h2>
            <button
              onClick={() => setShowCatalog(false)}
              className="p-1 text-[#999999] hover:text-[#E5E5E5] transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Search & Filter */}
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666666]" />
              <input
                type="text"
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder="Search models..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] text-sm text-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
              />
            </div>
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
            >
              <option value="">All Providers</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {isFetchingCatalog ? (
            <div className="flex items-center justify-center py-8 text-[#999999]">
              <Loader2 className="size-5 animate-spin mr-2" />
              Fetching OpenRouter catalog...
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-1 rounded-lg border border-[#2A2A2A]">
              {filteredCatalog.slice(0, 100).map((m) => (
                <CatalogRow key={m.modelId} model={m} onEnable={() => handleEnable(m)} />
              ))}
              {filteredCatalog.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-[#999999]">
                  {catalogSearch || providerFilter
                    ? "No models match your filters."
                    : "All available models are already enabled."}
                </div>
              )}
              {filteredCatalog.length > 100 && (
                <div className="px-4 py-2 text-center text-xs text-[#666666]">
                  Showing first 100 of {filteredCatalog.length} results. Use search to narrow down.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

/** Toggle switch (reused from SiteSettingsTab pattern). */
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 ${
        checked ? "bg-[#D4A574]" : "bg-[#2A2A2A]"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-[#161616] transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

/** Format cost for display. */
function formatCost(costPerM: string | null): string {
  if (!costPerM) return "—";
  const n = Number(costPerM);
  if (isNaN(n) || n === 0) return "Free";
  return `$${n.toFixed(2)}`;
}

/** Enabled model card with pricing, sort controls, and disable button. */
function ModelCard({
  model,
  onDisable,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  model: ModelOption;
  onDisable: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#2A2A2A] bg-[#161616] px-4 py-3 hover:border-[#D4A574]/30 transition-colors">
      {/* Sort arrows */}
      <div className="flex flex-col gap-0.5">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className="p-0.5 text-[#666666] hover:text-[#D4A574] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronUp className="size-3.5" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className="p-0.5 text-[#666666] hover:text-[#D4A574] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronDown className="size-3.5" />
        </button>
      </div>

      {/* Model info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#FAFAFA] truncate">
            {model.displayName}
          </span>
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[#2A2A2A] text-[#999999] uppercase">
            {model.provider}
          </span>
        </div>
        <div className="text-xs text-[#666666] truncate mt-0.5">{model.modelId}</div>
      </div>

      {/* Pricing */}
      <div className="flex items-center gap-4 text-xs text-[#999999] flex-shrink-0">
        {model.contextLength && (
          <span title="Context window">
            {(model.contextLength / 1000).toFixed(0)}k ctx
          </span>
        )}
        <span title="Input cost per 1M tokens">
          {formatCost(model.inputCostPerM)}/M in
        </span>
        <span title="Output cost per 1M tokens">
          {formatCost(model.outputCostPerM)}/M out
        </span>
      </div>

      {/* Disable */}
      <button
        onClick={onDisable}
        className="p-1.5 text-[#666666] hover:text-red-400 transition-colors"
        title="Disable model"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/** Row in the OpenRouter catalog browse view. */
function CatalogRow({
  model,
  onEnable,
}: {
  model: AvailableModel;
  onEnable: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 hover:bg-[#161616] transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#E5E5E5] truncate">{model.displayName}</span>
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-[#2A2A2A] text-[#666666] uppercase">
            {model.provider}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-[#666666]">
          <span>{model.modelId}</span>
          {model.contextLength && (
            <span>{(model.contextLength / 1000).toFixed(0)}k ctx</span>
          )}
          <span>{formatCost(model.inputCostPerM)}/M in</span>
          <span>{formatCost(model.outputCostPerM)}/M out</span>
        </div>
      </div>
      <button
        onClick={onEnable}
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#D4A574] bg-[#D4A574]/10 rounded-md hover:bg-[#D4A574]/20 transition-colors flex-shrink-0"
      >
        <Plus className="size-3" />
        Enable
      </button>
    </div>
  );
}

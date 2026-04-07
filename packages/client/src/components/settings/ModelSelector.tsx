/**
 * @module ModelSelector
 *
 * Custom dropdown for selecting an AI model, grouped by provider with
 * descriptions, context length, and token pricing. Replaces a basic
 * `<select>` with a visually rich, keyboard-accessible popover.
 */

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { type ModelOption } from "../../hooks/useModelOptions.js";
import { ChevronDown, Check, Sparkles } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelSelectorProps {
  /** Currently selected model ID (null = Global Default). */
  value: string | null;
  /** Called when the user picks a model. */
  onChange: (modelId: string | null) => void;
  /** Enabled models to show in the dropdown. */
  models: ModelOption[];
  /** When true, hides the "Global Default" option — a model must be selected. */
  required?: boolean;
  /** Optional class overrides for the trigger button. */
  className?: string;
}

/** A model grouped under its provider heading. */
interface ProviderGroup {
  provider: string;
  label: string;
  count: number;
  models: ModelOption[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capitalise and prettify provider slug (e.g. "anthropic" → "Anthropic"). */
function formatProvider(raw: string): string {
  const map: Record<string, string> = {
    anthropic: "Anthropic",
    google: "Google",
    openai: "OpenAI",
    meta: "Meta",
    perplexity: "Perplexity",
    mistralai: "Mistral",
    cohere: "Cohere",
    deepseek: "DeepSeek",
  };
  return map[raw.toLowerCase()] ?? raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Format context length for display. */
function fmtCtx(len: number | null): string {
  if (!len) return "";
  if (len >= 1_000_000) return `${(len / 1_000_000).toFixed(1)}M context`;
  return `${(len / 1_000).toFixed(0)}k context`;
}

/** Format token cost. */
function fmtCost(costPerM: string | null): string {
  if (!costPerM) return "—";
  const n = Number(costPerM);
  if (isNaN(n) || n === 0) return "Free";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** Group models by provider, preserving sort order. */
function groupByProvider(models: ModelOption[]): ProviderGroup[] {
  const map = new Map<string, ModelOption[]>();
  for (const m of models) {
    const key = m.provider.toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }
  return Array.from(map.entries()).map(([key, list]) => ({
    provider: key,
    label: formatProvider(key),
    count: list.length,
    models: list,
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ModelSelector({ value, onChange, models, required, className }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build a flat ordered list: [null (global default), ...models] or just [...models] if required
  const flatItems: Array<ModelOption | null> = required ? [...models] : [null, ...models];
  const groups = groupByProvider(models);

  // Resolve display text for the trigger
  const selected = value ? models.find((m) => m.modelId === value) : null;
  const triggerLabel = selected ? selected.displayName : (required ? "Select a model…" : "Global Default");
  const triggerSub = selected
    ? `via ${formatProvider(selected.provider)}`
    : (required ? "No model selected" : "Uses system-wide model");

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  // Scroll focused item into view
  useEffect(() => {
    if (!open || focusIdx < 0) return;
    const el = listRef.current?.querySelector(`[data-idx="${focusIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusIdx, open]);

  const handleSelect = useCallback(
    (modelId: string | null) => {
      onChange(modelId);
      setOpen(false);
    },
    [onChange],
  );

  function handleKeyDown(e: KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setFocusIdx(0);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusIdx((prev) => Math.min(prev + 1, flatItems.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusIdx((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (focusIdx >= 0) {
          const item = flatItems[focusIdx];
          handleSelect(item ? item.modelId : null);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          if (!open) setFocusIdx(value ? flatItems.findIndex((m) => m?.modelId === value) : 0);
        }}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-3 py-2.5 text-left transition-colors hover:border-[#3A3A3A] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-[#FAFAFA] truncate">{triggerLabel}</div>
          <div className="text-[11px] text-[#666666] truncate">{triggerSub}</div>
        </div>
        <ChevronDown
          className={`size-4 text-[#666666] flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown popover */}
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-activedescendant={focusIdx >= 0 ? `model-opt-${focusIdx}` : undefined}
          className="absolute z-50 mt-1 w-full max-h-80 overflow-y-auto rounded-lg border border-[#2A2A2A] bg-[#111111] shadow-xl shadow-black/40 backdrop-blur-sm"
        >
          {/* Global Default option (hidden when required) */}
          {!required && (
            <>
              <OptionRow
                idx={0}
                focused={focusIdx === 0}
                selected={value === null}
                onSelect={() => handleSelect(null)}
                onHover={() => setFocusIdx(0)}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-[#D4A574]" />
                  <div>
                    <div className="text-sm font-medium text-[#FAFAFA]">Global Default</div>
                    <div className="text-[11px] text-[#666666]">Uses the system-wide model</div>
                  </div>
                </div>
              </OptionRow>
              <div className="border-t border-[#1E1E1E]" />
            </>
          )}

          {/* Provider groups */}
          {groups.map((group) => (
            <div key={group.provider}>
              {/* Provider heading */}
              <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-[#0A0A0A]/90 backdrop-blur-sm border-b border-[#1E1E1E]">
                <span className="text-[10px] font-semibold text-[#666666] uppercase tracking-wider">
                  {group.label}
                </span>
                <span className="text-[10px] text-[#444444]">{group.count}</span>
              </div>

              {/* Models in this provider */}
              {group.models.map((m) => {
                const idx = flatItems.findIndex((fi) => fi?.modelId === m.modelId);
                return (
                  <OptionRow
                    key={m.modelId}
                    idx={idx}
                    focused={focusIdx === idx}
                    selected={value === m.modelId}
                    onSelect={() => handleSelect(m.modelId)}
                    onHover={() => setFocusIdx(idx)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[#E5E5E5]">{m.displayName}</div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[#666666]">
                        {m.contextLength ? (
                          <span>{fmtCtx(m.contextLength)}</span>
                        ) : null}
                        {(m.inputCostPerM || m.outputCostPerM) && (
                          <span>
                            ({fmtCost(m.inputCostPerM)}/{fmtCost(m.outputCostPerM)})
                          </span>
                        )}
                      </div>
                    </div>
                  </OptionRow>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Option row
// ---------------------------------------------------------------------------

function OptionRow({
  idx,
  focused,
  selected,
  onSelect,
  onHover,
  children,
}: {
  idx: number;
  focused: boolean;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      id={`model-opt-${idx}`}
      data-idx={idx}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${
        focused
          ? "bg-[#1E1E1E]"
          : "hover:bg-[#161616]"
      } ${selected ? "bg-[#D4A574]/5" : ""}`}
    >
      {children}
      {selected && <Check className="size-4 text-[#D4A574] flex-shrink-0 ml-2" />}
    </div>
  );
}

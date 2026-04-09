/**
 * @module components/inventory/SetupProgress
 *
 * Compact single-line onboarding bar shown on the LocationDashboard
 * when location setup is incomplete. Displays a segmented progress bar
 * with clickable step chips and an optional collapsible legend.
 *
 * ~80px collapsed, ~140px with legend expanded.
 * Dismissible once all steps are complete.
 */

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  HelpCircle,
  X,
} from "lucide-react";
import {
  SETUP_STEPS,
  STATUS_LEGEND,
  type StatusKey,
} from "@culinaire/shared";

// ─── Props ─────────────────────────────────────────────────────

export interface SetupProgressProps {
  setupProgress: {
    locationCreated: boolean;
    itemsActivated: boolean;
    itemsActivatedCount: number;
    parLevelsSet: boolean;
    parLevelsCount: number;
    openingCountCompleted: boolean;
    inventoryActive: boolean;
  };
  onNavigate: (step: string) => void;
}

// ─── Helpers ───────────────────────────────────────────────────

function getStepStatus(
  stepKey: string,
  progress: SetupProgressProps["setupProgress"],
): StatusKey {
  switch (stepKey) {
    case "location_created":
      return "complete"; // always true if we're rendering this component
    case "items_activated":
      return progress.itemsActivated ? "complete" : "not_started";
    case "par_levels_set":
      if (!progress.itemsActivated) return "not_started";
      return progress.parLevelsSet ? "complete" : "warning";
    case "opening_count":
      if (!progress.itemsActivated) return "not_started";
      return progress.openingCountCompleted ? "complete" : "not_started";
    default:
      return "not_started";
  }
}

/** Short chip label for each step */
function getChipLabel(
  stepKey: string,
  status: StatusKey,
  progress: SetupProgressProps["setupProgress"],
): string {
  const prefix = status === "complete" ? "\u2713" : status === "warning" ? "!" : "\u2717";
  switch (stepKey) {
    case "location_created":
      return `${prefix} Location`;
    case "items_activated":
      return progress.itemsActivatedCount > 0
        ? `${prefix} Items (${progress.itemsActivatedCount})`
        : `${prefix} Items`;
    case "par_levels_set":
      return progress.parLevelsCount > 0
        ? `${prefix} Par Levels (${progress.parLevelsCount})`
        : `${prefix} Par Levels`;
    case "opening_count":
      return `${prefix} Opening Count`;
    default:
      return `${prefix} Step`;
  }
}

const SEGMENT_BG: Record<StatusKey, string> = {
  complete: "bg-emerald-500",
  warning: "bg-amber-500",
  not_started: "bg-[#2A2A2A]",
  in_progress: "bg-sky-500",
};

const CHIP_STYLES: Record<StatusKey, string> = {
  complete:
    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20",
  warning:
    "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20",
  not_started:
    "bg-[#1E1E1E] text-[#666] border-[#2A2A2A] hover:bg-[#2A2A2A]",
  in_progress:
    "bg-sky-500/10 text-sky-400 border-sky-500/20 hover:bg-sky-500/20",
};

const ICON_COLORS: Record<StatusKey, string> = {
  complete: "text-emerald-400",
  warning: "text-amber-400",
  not_started: "text-red-400",
  in_progress: "text-sky-400",
};

// ─── Component ─────────────────────────────────────────────────

export function SetupProgress({ setupProgress, onNavigate }: SetupProgressProps) {
  const [legendOpen, setLegendOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const statuses = SETUP_STEPS.map((step) => getStepStatus(step.key, setupProgress));
  const completedCount = statuses.filter((s) => s === "complete").length;
  const totalSteps = SETUP_STEPS.length;
  const allComplete = completedCount === totalSteps;

  if (dismissed) return null;

  return (
    <div className="rounded-xl bg-[#111]/80 border border-white/5 p-4 transition-all duration-300">
      {/* Top line: label + count + dismiss */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-[#FAFAFA]">
            Setup Your Inventory
          </span>
          <span className="text-xs text-[#888]">
            {allComplete
              ? "All steps complete!"
              : `${completedCount} of ${totalSteps} complete`}
          </span>
        </div>

        {allComplete && (
          <button
            onClick={() => setDismissed(true)}
            className="p-1 rounded-md text-[#666] hover:text-white hover:bg-white/5 transition-colors"
            title="Dismiss"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Segmented progress bar */}
      <div className="flex gap-1 mb-2.5">
        {SETUP_STEPS.map((_, idx) => (
          <div
            key={idx}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${SEGMENT_BG[statuses[idx]]}`}
          />
        ))}
      </div>

      {/* Step chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SETUP_STEPS.map((step, idx) => {
          const status = statuses[idx];
          return (
            <button
              key={step.key}
              onClick={() => onNavigate(step.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border cursor-pointer transition-colors ${CHIP_STYLES[status]}`}
            >
              {getChipLabel(step.key, status, setupProgress)}
            </button>
          );
        })}

        {/* Legend toggle */}
        <button
          onClick={() => setLegendOpen((prev) => !prev)}
          className="flex items-center gap-1 ml-1 text-[10px] text-[#555] hover:text-[#999] transition-colors"
        >
          <HelpCircle className="size-3" />
          <span>What do these mean?</span>
          {legendOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      </div>

      {/* Collapsible legend */}
      {legendOpen && (
        <div className="bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg p-3 mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 animate-in slide-in-from-top-2 duration-200">
          {(Object.keys(STATUS_LEGEND) as StatusKey[]).map((key) => {
            const entry = STATUS_LEGEND[key];
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className={`text-xs ${ICON_COLORS[key]}`}>
                  {entry.icon}
                </span>
                <span className="text-[10px] text-[#999]">{entry.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

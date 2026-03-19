/**
 * @module components/menu/MenuEngineeringMatrix
 *
 * CSS-based scatter plot showing menu items positioned by
 * Contribution Margin (Y-axis) vs Menu Mix % (X-axis).
 * Quadrants: Star (top-right), Plowhorse (bottom-right),
 * Puzzle (top-left), Dog (bottom-left).
 */

import { useState, useMemo } from "react";
import { Loader2, BarChart3 } from "lucide-react";
import type { MenuItem } from "../../hooks/useMenuItems.js";

/* ---- Dot colors per classification ---- */

const DOT_COLORS: Record<string, string> = {
  star: "#D4A574",
  plowhorse: "#3B82F6",
  puzzle: "#A855F7",
  dog: "#666666",
  unclassified: "#444444",
};

const QUADRANT_SUMMARY = [
  { key: "star", label: "Stars", color: "text-[#D4A574]", bg: "bg-[#D4A574]/15" },
  { key: "plowhorse", label: "Plowhorses", color: "text-blue-400", bg: "bg-blue-500/15" },
  { key: "puzzle", label: "Puzzles", color: "text-purple-400", bg: "bg-purple-500/15" },
  { key: "dog", label: "Dogs", color: "text-[#666666]", bg: "bg-[#2A2A2A]" },
] as const;

interface MenuEngineeringMatrixProps {
  items: MenuItem[];
  loading: boolean;
  onSelect: (item: MenuItem) => void;
}

export function MenuEngineeringMatrix({
  items,
  loading,
  onSelect,
}: MenuEngineeringMatrixProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const classified = useMemo(
    () => items.filter((i) => i.unitsSold > 0),
    [items]
  );

  // Quadrant counts
  const counts = useMemo(() => {
    const c = { star: 0, plowhorse: 0, puzzle: 0, dog: 0 };
    for (const item of classified) {
      if (item.classification in c) {
        c[item.classification as keyof typeof c]++;
      }
    }
    return c;
  }, [classified]);

  // Calculate averages and bounds
  const { avgCM, avgMix, maxCM, maxMix } = useMemo(() => {
    if (classified.length === 0) {
      return { avgCM: 0, avgMix: 0, maxCM: 1, maxMix: 1 };
    }
    const aCM =
      classified.reduce((s, i) => s + i.contributionMargin, 0) /
      classified.length;
    const aMix =
      classified.reduce((s, i) => s + i.menuMixPct, 0) / classified.length;
    const mCM =
      Math.max(...classified.map((i) => i.contributionMargin)) * 1.2 || 1;
    const mMix = Math.max(...classified.map((i) => i.menuMixPct)) * 1.2 || 1;
    return { avgCM: aCM, avgMix: aMix, maxCM: mCM, maxMix: mMix };
  }, [classified]);

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  if (classified.length < 2) {
    return (
      <div className="bg-[#161616] rounded-2xl border border-[#2A2A2A] p-12 text-center">
        <BarChart3 className="size-12 mx-auto mb-4 text-[#333333]" />
        <h3 className="text-lg font-semibold text-[#FAFAFA] mb-2">
          Not enough data
        </h3>
        <p className="text-sm text-[#666666] max-w-md mx-auto">
          Add menu items with sales data to see the engineering matrix. At least
          2 items with units sold are needed.
        </p>
      </div>
    );
  }

  // Convert item values to percentage positions (0-100)
  function toXPct(mix: number) {
    return Math.min(Math.max((mix / maxMix) * 100, 2), 98);
  }
  function toYPct(cm: number) {
    // Invert Y: 0% = top, 100% = bottom
    return Math.min(Math.max(100 - (cm / maxCM) * 100, 2), 98);
  }

  const avgXPct = toXPct(avgMix);
  const avgYPct = toYPct(avgCM);

  return (
    <div className="space-y-4">
      {/* Matrix container */}
      <div className="bg-[#161616] rounded-2xl border border-[#2A2A2A] p-4 sm:p-6">
        <h3 className="text-sm font-semibold text-[#FAFAFA] mb-4">
          Menu Engineering Matrix
        </h3>

        {/* Chart area */}
        <div className="relative">
          {/* Y-axis label */}
          <div className="absolute -left-1 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] text-[#666666] whitespace-nowrap select-none">
            Profitability (Contribution Margin)
          </div>

          {/* Main plot area */}
          <div
            className="relative ml-6 mr-2"
            style={{ aspectRatio: "3 / 2", minHeight: 300 }}
          >
            {/* Background grid */}
            <div className="absolute inset-0 rounded-xl overflow-hidden">
              {/* Quadrant background colors */}
              {/* Top-left: Puzzles */}
              <div
                className="absolute bg-purple-500/5"
                style={{
                  left: 0,
                  top: 0,
                  width: `${avgXPct}%`,
                  height: `${avgYPct}%`,
                }}
              />
              {/* Top-right: Stars */}
              <div
                className="absolute bg-[#D4A574]/5"
                style={{
                  left: `${avgXPct}%`,
                  top: 0,
                  right: 0,
                  height: `${avgYPct}%`,
                }}
              />
              {/* Bottom-left: Dogs */}
              <div
                className="absolute bg-[#2A2A2A]/30"
                style={{
                  left: 0,
                  top: `${avgYPct}%`,
                  width: `${avgXPct}%`,
                  bottom: 0,
                }}
              />
              {/* Bottom-right: Plowhorses */}
              <div
                className="absolute bg-blue-500/5"
                style={{
                  left: `${avgXPct}%`,
                  top: `${avgYPct}%`,
                  right: 0,
                  bottom: 0,
                }}
              />
            </div>

            {/* Crosshair lines */}
            <div
              className="absolute top-0 bottom-0 w-px bg-[#333333]"
              style={{ left: `${avgXPct}%` }}
            />
            <div
              className="absolute left-0 right-0 h-px bg-[#333333]"
              style={{ top: `${avgYPct}%` }}
            />

            {/* Quadrant labels */}
            <div
              className="absolute text-[10px] sm:text-xs text-purple-400/60 font-medium select-none"
              style={{ left: 8, top: 8 }}
            >
              Puzzles
            </div>
            <div
              className="absolute text-[10px] sm:text-xs text-[#D4A574]/60 font-medium select-none"
              style={{ right: 8, top: 8 }}
            >
              Stars
            </div>
            <div
              className="absolute text-[10px] sm:text-xs text-[#666666]/60 font-medium select-none"
              style={{ left: 8, bottom: 8 }}
            >
              Dogs
            </div>
            <div
              className="absolute text-[10px] sm:text-xs text-blue-400/60 font-medium select-none"
              style={{ right: 8, bottom: 8 }}
            >
              Plowhorses
            </div>

            {/* Data points */}
            {classified.map((item) => {
              const x = toXPct(item.menuMixPct);
              const y = toYPct(item.contributionMargin);
              const color =
                DOT_COLORS[item.classification] ?? DOT_COLORS.unclassified;
              const isHovered = hoveredId === item.menuItemId;

              return (
                <div
                  key={item.menuItemId}
                  className="absolute cursor-pointer transition-transform duration-150"
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    transform: `translate(-50%, -50%) scale(${isHovered ? 1.5 : 1})`,
                    zIndex: isHovered ? 20 : 10,
                  }}
                  onMouseEnter={() => setHoveredId(item.menuItemId)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => onSelect(item)}
                >
                  {/* Dot */}
                  <div
                    className="size-4 rounded-full border-2 border-[#161616]"
                    style={{ backgroundColor: color }}
                  />

                  {/* Tooltip */}
                  {isHovered && (
                    <div
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg shadow-xl whitespace-nowrap z-30 pointer-events-none"
                    >
                      <p className="text-xs font-semibold text-[#FAFAFA]">
                        {item.name}
                      </p>
                      <p className="text-[10px] text-[#999999]">
                        CM: ${item.contributionMargin.toFixed(2)} | Mix:{" "}
                        {item.menuMixPct.toFixed(1)}%
                      </p>
                      <div
                        className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
                        style={{
                          borderLeft: "4px solid transparent",
                          borderRight: "4px solid transparent",
                          borderTop: "4px solid #2A2A2A",
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {/* Border */}
            <div className="absolute inset-0 rounded-xl border border-[#2A2A2A] pointer-events-none" />
          </div>

          {/* X-axis label */}
          <div className="text-center mt-2 text-[10px] text-[#666666] select-none">
            Popularity (Menu Mix %)
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap justify-center gap-4 mt-4 text-xs text-[#999999]">
          {Object.entries(DOT_COLORS)
            .filter(([k]) => k !== "unclassified")
            .map(([key, color]) => (
              <span key={key} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </span>
            ))}
        </div>
      </div>

      {/* Quadrant summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {QUADRANT_SUMMARY.map(({ key, label, color, bg }) => (
          <div
            key={key}
            className={`${bg} rounded-xl px-4 py-3 text-center`}
          >
            <p className={`text-2xl font-bold ${color}`}>{counts[key]}</p>
            <p className={`text-xs font-medium ${color}`}>{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

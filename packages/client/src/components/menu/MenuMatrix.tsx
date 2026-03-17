/**
 * Interactive scatter plot showing menu items by
 * Contribution Margin (Y) vs Menu Mix % (X).
 * Divided into four quadrants: Star, Plowhorse, Puzzle, Dog.
 */

import type { MenuItem } from "../../hooks/useMenuItems.js";

const CLASS_COLORS: Record<string, string> = {
  star: "#d97706",
  plowhorse: "#2563eb",
  puzzle: "#9333ea",
  dog: "#dc2626",
  unclassified: "#a8a29e",
};

interface MenuMatrixProps {
  items: MenuItem[];
  onSelect: (item: MenuItem) => void;
}

export function MenuMatrix({ items, onSelect }: MenuMatrixProps) {
  const classified = items.filter((i) => i.unitsSold > 0);

  if (classified.length < 2) {
    return (
      <div className="bg-white rounded-xl border border-stone-200 p-8 text-center text-stone-400">
        <p className="text-sm">Add sales data to at least 2 items to see the matrix</p>
      </div>
    );
  }

  // Calculate averages for quadrant lines
  const avgCM = classified.reduce((s, i) => s + i.contributionMargin, 0) / classified.length;
  const avgMix = classified.reduce((s, i) => s + i.menuMixPct, 0) / classified.length;

  // Chart bounds with padding
  const maxCM = Math.max(...classified.map((i) => i.contributionMargin)) * 1.15;
  const maxMix = Math.max(...classified.map((i) => i.menuMixPct)) * 1.15;

  const W = 600;
  const H = 400;
  const PAD = 50;

  function toX(mix: number) { return PAD + ((mix / maxMix) * (W - PAD * 2)); }
  function toY(cm: number) { return H - PAD - ((cm / maxCM) * (H - PAD * 2)); }

  const avgLineX = toX(avgMix);
  const avgLineY = toY(avgCM);

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <h3 className="text-sm font-semibold text-stone-800 mb-3">Menu Engineering Matrix</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-2xl mx-auto">
        {/* Quadrant background colors */}
        <rect x={PAD} y={PAD} width={avgLineX - PAD} height={avgLineY - PAD} fill="#fef3c7" opacity={0.3} /> {/* Puzzle: left-top */}
        <rect x={avgLineX} y={PAD} width={W - PAD - avgLineX} height={avgLineY - PAD} fill="#fef9c3" opacity={0.3} /> {/* Star: right-top */}
        <rect x={PAD} y={avgLineY} width={avgLineX - PAD} height={H - PAD - avgLineY} fill="#fee2e2" opacity={0.3} /> {/* Dog: left-bottom */}
        <rect x={avgLineX} y={avgLineY} width={W - PAD - avgLineX} height={H - PAD - avgLineY} fill="#dbeafe" opacity={0.3} /> {/* Plowhorse: right-bottom */}

        {/* Quadrant labels */}
        <text x={PAD + 8} y={PAD + 16} className="text-[10px]" fill="#9333ea" opacity={0.6}>Puzzles</text>
        <text x={W - PAD - 40} y={PAD + 16} className="text-[10px]" fill="#d97706" opacity={0.6}>Stars</text>
        <text x={PAD + 8} y={H - PAD - 8} className="text-[10px]" fill="#dc2626" opacity={0.6}>Dogs</text>
        <text x={W - PAD - 60} y={H - PAD - 8} className="text-[10px]" fill="#2563eb" opacity={0.6}>Plowhorses</text>

        {/* Average lines */}
        <line x1={avgLineX} y1={PAD} x2={avgLineX} y2={H - PAD} stroke="#a8a29e" strokeWidth={1} strokeDasharray="4,4" />
        <line x1={PAD} y1={avgLineY} x2={W - PAD} y2={avgLineY} stroke="#a8a29e" strokeWidth={1} strokeDasharray="4,4" />

        {/* Axes */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#d6d3d1" strokeWidth={1} />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#d6d3d1" strokeWidth={1} />

        {/* Axis labels */}
        <text x={W / 2} y={H - 10} textAnchor="middle" className="text-[11px]" fill="#78716c">Popularity (Menu Mix %)</text>
        <text x={15} y={H / 2} textAnchor="middle" className="text-[11px]" fill="#78716c" transform={`rotate(-90, 15, ${H / 2})`}>Contribution Margin ($)</text>

        {/* Data points */}
        {classified.map((item) => (
          <g key={item.menuItemId} onClick={() => onSelect(item)} className="cursor-pointer">
            <circle
              cx={toX(item.menuMixPct)}
              cy={toY(item.contributionMargin)}
              r={8}
              fill={CLASS_COLORS[item.classification] ?? CLASS_COLORS.unclassified}
              opacity={0.8}
              stroke="white"
              strokeWidth={2}
            />
            <title>{`${item.name}\nCM: $${item.contributionMargin.toFixed(2)}\nMix: ${item.menuMixPct.toFixed(1)}%\n${item.classification}`}</title>
          </g>
        ))}
      </svg>
      <div className="flex justify-center gap-4 mt-3 text-xs text-stone-500">
        {Object.entries(CLASS_COLORS).filter(([k]) => k !== "unclassified").map(([key, color]) => (
          <span key={key} className="flex items-center gap-1">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </span>
        ))}
      </div>
    </div>
  );
}

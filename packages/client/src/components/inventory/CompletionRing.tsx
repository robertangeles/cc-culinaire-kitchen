/**
 * @module components/inventory/CompletionRing
 *
 * Circular SVG progress indicator with amber-to-emerald color transition.
 * Pulses at 100% completion. Uses CSS transitions for smooth progress updates.
 */

interface CompletionRingProps {
  progress: number;       // 0-1
  size?: number;          // px, default 48
  strokeWidth?: number;   // default 4
  label?: string;         // text inside ring
}

export function CompletionRing({
  progress,
  size = 48,
  strokeWidth = 4,
  label,
}: CompletionRingProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  const isComplete = clamped >= 1;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);

  const strokeColor = isComplete ? "#34d399" : "#fbbf24"; // emerald-400 / amber-400

  return (
    <div
      className={`relative inline-flex items-center justify-center ${
        isComplete ? "animate-[pulse_2s_ease-in-out_infinite]" : ""
      }`}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="transform -rotate-90"
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#2A2A2A"
          strokeWidth={strokeWidth}
        />
        {/* Progress ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), stroke 0.3s ease",
          }}
        />
      </svg>
      {label && (
        <span
          className="absolute inset-0 flex items-center justify-center text-xs font-semibold"
          style={{ color: strokeColor, transition: "color 0.3s ease" }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

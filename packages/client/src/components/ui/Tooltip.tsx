/**
 * @module components/ui/Tooltip
 *
 * Reusable hover tooltip with Infection Virus design — glass morphism,
 * amber glow, gradient border, micro-animation on appear.
 */

import { useState, useRef, type ReactNode } from "react";

interface TooltipProps {
  text: string;
  children: ReactNode;
  position?: "top" | "bottom";
  delay?: number;
}

export function Tooltip({ text, children, position = "bottom", delay = 300 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function handleEnter() {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }

  function handleLeave() {
    clearTimeout(timerRef.current);
    setVisible(false);
  }

  const isTop = position === "top";
  const positionClasses = isTop
    ? "bottom-full left-1/2 -translate-x-1/2 mb-3"
    : "top-full left-1/2 -translate-x-1/2 mt-3";

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {children}

      {visible && (
        <div
          role="tooltip"
          className={`absolute z-50 ${positionClasses} pointer-events-none w-max`}
          style={{ filter: "drop-shadow(0 0 12px rgba(212, 165, 116, 0.12))" }}
        >
          {/* Outer glow border via gradient */}
          <div
            className="rounded-xl p-[1px]"
            style={{
              background: "linear-gradient(135deg, rgba(212,165,116,0.4), rgba(212,165,116,0.08) 50%, rgba(212,165,116,0.2))",
            }}
          >
            {/* Glass inner */}
            <div
              className="rounded-[11px] px-4 py-2.5 min-w-[200px] max-w-[280px] backdrop-blur-xl"
              style={{
                background: "linear-gradient(135deg, rgba(38,32,26,0.97), rgba(25,22,18,0.99))",
                boxShadow: "inset 0 1px 0 rgba(212,165,116,0.1), inset 0 -1px 0 rgba(0,0,0,0.4), 0 8px 32px rgba(0,0,0,0.7)",
              }}
            >
              <p className="text-[12px] font-medium leading-relaxed text-[#E8DDD0] tracking-wide">
                {text}
              </p>
            </div>
          </div>

          {/* Arrow */}
          <div
            className={`absolute left-1/2 -translate-x-1/2 ${isTop ? "top-full -mt-[1px]" : "bottom-full -mb-[1px]"}`}
          >
            <svg width="14" height="7" viewBox="0 0 14 7" className={isTop ? "" : "rotate-180"}>
              <path
                d="M0 0 L7 7 L14 0"
                fill="rgba(32,28,22,0.97)"
                stroke="rgba(212,165,116,0.3)"
                strokeWidth="1"
              />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * @module components/inventory/SmartKeypad
 *
 * Mobile-optimized numeric keypad for stock take counting.
 * Features: large touch targets, +/- steppers, quick quantity buttons,
 * decimal support, one-handed thumb-reachable layout.
 *
 * Design constraint: "completable one-handed on a phone" — all buttons
 * are in the lower 60% of the screen, sized for wet/gloved thumbs.
 */

import { useState } from "react";
import { Check, X, Minus, Plus, Delete, Loader2 } from "lucide-react";

interface Props {
  unit: string;
  initialValue?: number;
  isSaving: boolean;
  onSave: (qty: number) => void;
  onCancel: () => void;
}

const QUICK_QTYS = [0, 0.5, 1, 5, 10, 25];

export function SmartKeypad({ unit, initialValue, isSaving, onSave, onCancel }: Props) {
  const [display, setDisplay] = useState(initialValue?.toString() ?? "0");

  const numValue = Number(display) || 0;

  const handleDigit = (d: string) => {
    setDisplay((prev) => {
      if (prev === "0" && d !== ".") return d;
      if (d === "." && prev.includes(".")) return prev;
      return prev + d;
    });
  };

  const handleDelete = () => {
    setDisplay((prev) => (prev.length <= 1 ? "0" : prev.slice(0, -1)));
  };

  const handleClear = () => setDisplay("0");

  const handleStep = (delta: number) => {
    const next = Math.max(0, numValue + delta);
    setDisplay(Number.isInteger(next) ? next.toString() : next.toFixed(2));
  };

  const handleQuick = (qty: number) => {
    setDisplay(Number.isInteger(qty) ? qty.toString() : qty.toFixed(1));
  };

  return (
    <div className="max-w-sm mx-auto animate-[scaleIn_200ms_ease-out]">
      {/* Display */}
      <div className="mb-6 text-center">
        <div className="inline-flex items-baseline gap-2 px-6 py-4 rounded-2xl bg-dark-50 border border-dark-200 min-w-[200px]">
          <span className="text-4xl font-bold text-white tabular-nums">{display}</span>
          <span className="text-lg text-dark-600">{unit}</span>
        </div>
      </div>

      {/* Quick quantity buttons */}
      <div className="flex gap-2 mb-4 justify-center">
        {QUICK_QTYS.map((q) => (
          <button
            key={q}
            onClick={() => handleQuick(q)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all active:scale-95 ${
              numValue === q
                ? "bg-gold text-dark"
                : "bg-dark-100 text-dark-600 hover:text-white border border-dark-200 hover:border-dark-300"
            }`}
          >
            {q}
          </button>
        ))}
      </div>

      {/* +/- Steppers */}
      <div className="flex items-center justify-center gap-4 mb-4">
        <button
          onClick={() => handleStep(-1)}
          className="w-14 h-14 rounded-xl bg-dark-100 border border-dark-200 flex items-center justify-center text-white hover:bg-dark-200 active:scale-95 transition-all"
        >
          <Minus className="size-5" />
        </button>
        <button
          onClick={() => handleStep(-0.5)}
          className="w-12 h-12 rounded-xl bg-dark-100 border border-dark-200 flex items-center justify-center text-dark-600 text-sm hover:bg-dark-200 active:scale-95 transition-all"
        >
          -½
        </button>
        <button
          onClick={() => handleStep(0.5)}
          className="w-12 h-12 rounded-xl bg-dark-100 border border-dark-200 flex items-center justify-center text-dark-600 text-sm hover:bg-dark-200 active:scale-95 transition-all"
        >
          +½
        </button>
        <button
          onClick={() => handleStep(1)}
          className="w-14 h-14 rounded-xl bg-dark-100 border border-dark-200 flex items-center justify-center text-white hover:bg-dark-200 active:scale-95 transition-all"
        >
          <Plus className="size-5" />
        </button>
      </div>

      {/* Numeric keypad grid */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((key) => (
          <button
            key={key}
            onClick={() => {
              if (key === "del") handleDelete();
              else handleDigit(key);
            }}
            onDoubleClick={() => { if (key === "del") handleClear(); }}
            className="h-14 rounded-xl bg-dark-100 border border-dark-200 flex items-center justify-center text-lg font-medium text-white hover:bg-dark-200 active:scale-95 transition-all"
          >
            {key === "del" ? <Delete className="size-5 text-dark-600" /> : key}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 h-14 rounded-xl bg-dark-100 border border-dark-200 flex items-center justify-center gap-2 text-dark-600 hover:text-white transition-colors active:scale-[0.98]"
        >
          <X className="size-5" />
          Cancel
        </button>
        <button
          onClick={() => onSave(numValue)}
          disabled={isSaving}
          className="flex-[2] h-14 rounded-xl bg-gradient-to-r from-gold to-gold-hover flex items-center justify-center gap-2 text-dark font-semibold hover:shadow-[0_0_16px_rgba(212,165,116,0.3)] transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <>
              <Check className="size-5" />
              Save Count
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * @module components/inventory/TransferReceiving
 *
 * Receiving UI for an incoming inter-location transfer.
 * Shows sent quantities, allows entering received quantities,
 * highlights discrepancies, and confirms receipt.
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "../../context/LocationContext.js";
import {
  useTransfers,
  type TransferDetail,
  type TransferLineDetail,
} from "../../hooks/useInventory.js";
import {
  ArrowLeft,
  PackageCheck,
  AlertTriangle,
  Loader2,
  ArrowRight,
  Check,
} from "lucide-react";

const API = "/api/inventory";
const opts = { credentials: "include" as const };

/* ── Component ────────────────────────────────────────────────── */

export default function TransferReceiving({
  transferId,
  onClose,
}: {
  transferId: string;
  onClose: () => void;
}) {
  const { selectedLocationId } = useLocation();
  const { confirmReceived } = useTransfers(selectedLocationId);

  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [receivedQtys, setReceivedQtys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch transfer detail
  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const res = await fetch(`${API}/transfers/${transferId}`, opts);
        if (res.ok) {
          const data = await res.json();
          setDetail(data);
          // Pre-fill received quantities with sent quantities
          const defaults: Record<string, string> = {};
          for (const line of data.lines || []) {
            defaults[line.lineId] = line.sentQty;
          }
          setReceivedQtys(defaults);
        }
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [transferId]);

  function updateReceivedQty(lineId: string, qty: string) {
    setReceivedQtys((prev) => ({ ...prev, [lineId]: qty }));
  }

  function hasDiscrepancy(line: TransferLineDetail): boolean {
    const received = Number(receivedQtys[line.lineId] || 0);
    const sent = Number(line.sentQty);
    return Math.abs(received - sent) > 0.001;
  }

  const handleConfirm = useCallback(async () => {
    if (!detail) return;
    setError(null);
    setSaving(true);

    try {
      const receivedLines = detail.lines.map((line) => ({
        lineId: line.lineId,
        receivedQty: Number(receivedQtys[line.lineId] || line.sentQty),
      }));

      await confirmReceived(transferId, receivedLines);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to confirm receipt");
    } finally {
      setSaving(false);
    }
  }, [detail, receivedQtys, transferId, confirmReceived, onClose]);

  const anyDiscrepancy = detail?.lines.some(hasDiscrepancy) ?? false;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-amber-400" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-400">Transfer not found</p>
        <button onClick={onClose} className="mt-4 text-amber-400 text-sm hover:underline">
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="p-2 rounded-xl bg-surface-2/50 border border-white/5 hover:border-amber-500/20 transition-colors"
        >
          <ArrowLeft size={18} className="text-zinc-400" />
        </button>
        <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <PackageCheck size={20} className="text-emerald-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Receive Transfer</h2>
          <p className="text-xs text-zinc-500 flex items-center gap-1">
            From <span className="text-zinc-300">{detail.fromLocationName}</span>
            <ArrowRight size={12} className="text-zinc-600" />
            <span className="text-zinc-300">{detail.toLocationName}</span>
          </p>
        </div>
      </div>

      {/* Notes */}
      {detail.notes && (
        <div className="px-4 py-2 rounded-xl bg-surface-2/40 border border-white/5 text-sm text-zinc-400">
          <span className="text-zinc-500">Notes:</span> {detail.notes}
        </div>
      )}

      {/* Line items */}
      <div className="p-4 rounded-xl bg-surface-2/40 border border-white/5 backdrop-blur-sm">
        <div className="grid grid-cols-[1fr_80px_80px_40px] gap-2 mb-2 px-1 text-xs text-zinc-500 font-medium uppercase tracking-wider">
          <span>Item</span>
          <span className="text-right">Sent</span>
          <span className="text-right">Received</span>
          <span></span>
        </div>

        <div className="space-y-2">
          {detail.lines.map((line) => {
            const disc = hasDiscrepancy(line);
            return (
              <div
                key={line.lineId}
                className={`grid grid-cols-[1fr_80px_80px_40px] gap-2 items-center px-3 py-2.5 rounded-lg border transition-all ${
                  disc
                    ? "bg-red-900/20 border-red-600/30"
                    : "bg-surface-1/60 border-white/5"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200 truncate">{line.ingredientName}</p>
                  <p className="text-xs text-zinc-500">{line.ingredientCategory}</p>
                </div>
                <div className="text-right">
                  <span className="text-sm text-zinc-300">
                    {Number(line.sentQty).toFixed(1)}
                  </span>
                  <span className="text-xs text-zinc-500 ml-1">{line.sentUnit}</span>
                </div>
                <input
                  type="number"
                  value={receivedQtys[line.lineId] || ""}
                  onChange={(e) => updateReceivedQty(line.lineId, e.target.value)}
                  min="0"
                  step="0.01"
                  className={`w-full px-2 py-1 rounded-md text-sm text-right transition-colors ${
                    disc
                      ? "bg-red-900/30 border-red-600/40 text-red-200 focus:border-red-500/60"
                      : "bg-surface-2 border-white/10 text-zinc-100 focus:border-amber-500/40"
                  } border`}
                />
                <div className="flex justify-center">
                  {disc ? (
                    <AlertTriangle size={16} className="text-red-400" />
                  ) : (
                    <Check size={16} className="text-emerald-500/60" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Discrepancy warning */}
      {anyDiscrepancy && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-900/20 border border-amber-500/20">
          <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-300">Quantity Discrepancy Detected</p>
            <p className="text-xs text-amber-400/70 mt-0.5">
              One or more items have different received quantities. The transfer will be
              marked as DISCREPANCY for review.
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-2 rounded-lg bg-red-900/30 border border-red-600/30 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Confirm button */}
      <button
        onClick={handleConfirm}
        disabled={saving}
        className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold transition-all duration-200 disabled:opacity-50 ${
          anyDiscrepancy
            ? "bg-gradient-to-r from-amber-600 to-orange-600 text-zinc-950 hover:shadow-[0_0_16px_rgba(255,160,10,0.3)]"
            : "bg-gradient-to-r from-emerald-600 to-green-600 text-zinc-950 hover:shadow-[0_0_16px_rgba(52,211,153,0.3)]"
        } hover:-translate-y-0.5 disabled:hover:translate-y-0`}
      >
        {saving ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <PackageCheck size={18} />
        )}
        {anyDiscrepancy ? "Confirm Receipt (with Discrepancy)" : "Confirm Receipt"}
      </button>
    </div>
  );
}

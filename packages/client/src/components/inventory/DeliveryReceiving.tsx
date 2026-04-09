/**
 * @module components/inventory/DeliveryReceiving
 *
 * Delivery receiving interface for a submitted PO.
 * Shows ordered vs received qty per line, allows confirming
 * receipt per line, and highlights discrepancies.
 */

import { useState, useCallback } from "react";
import { useLocation } from "../../context/LocationContext.js";
import { usePurchaseOrders, type PurchaseOrder, type PurchaseOrderLine } from "../../hooks/useInventory.js";
import {
  ArrowLeft,
  Check,
  AlertTriangle,
  Loader2,
  Truck,
  Package,
  CheckCircle2,
} from "lucide-react";

/* ── Status helpers ──────────────────────────────────────────── */

const LINE_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PENDING:  { bg: "bg-[#333]/60",      text: "text-[#999]",      label: "Pending" },
  RECEIVED: { bg: "bg-emerald-500/15",  text: "text-emerald-400", label: "Received" },
};

function LineStatusBadge({ status }: { status: string }) {
  const s = LINE_STATUS_STYLES[status] ?? LINE_STATUS_STYLES.PENDING;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

/* ── Props ────────────────────────────────────────────────────── */

interface Props {
  po: PurchaseOrder;
  onBack: () => void;
}

/* ── Component ────────────────────────────────────────────────── */

export default function DeliveryReceiving({ po, onBack }: Props) {
  const { selectedLocationId } = useLocation();
  const { receiveLine, getDetail } = usePurchaseOrders(selectedLocationId);

  const [lines, setLines] = useState<PurchaseOrderLine[]>(po.lines ?? []);
  const [receiveData, setReceiveData] = useState<Record<string, {
    receivedQty: string;
    receivedUnit: string;
    unitCost: string;
  }>>(() => {
    const init: Record<string, any> = {};
    for (const line of po.lines ?? []) {
      init[line.lineId] = {
        receivedQty: line.orderedQty,
        receivedUnit: line.orderedUnit,
        unitCost: line.unitCost ?? "",
      };
    }
    return init;
  });
  const [loadingLine, setLoadingLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleReceive = useCallback(async (lineId: string) => {
    const data = receiveData[lineId];
    if (!data || !data.receivedQty) return;

    setLoadingLine(lineId);
    setError(null);
    try {
      await receiveLine(po.poId, lineId, {
        receivedQty: data.receivedQty,
        receivedUnit: data.receivedUnit,
        unitCost: data.unitCost || null,
      });

      // Refresh the PO to get updated line statuses
      const updated = await getDetail(po.poId);
      if (updated?.lines) setLines(updated.lines);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingLine(null);
    }
  }, [po.poId, receiveData, receiveLine, getDetail]);

  const updateReceiveData = useCallback((lineId: string, field: string, value: string) => {
    setReceiveData((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], [field]: value },
    }));
  }, []);

  const pendingLines = lines.filter((l) => l.lineStatus === "PENDING");
  const receivedLines = lines.filter((l) => l.lineStatus === "RECEIVED");
  const allReceived = pendingLines.length === 0 && receivedLines.length > 0;

  return (
    <div className="space-y-6 animate-[fadeInUp_200ms_ease-out]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 rounded-lg text-[#999] hover:text-white hover:bg-[#1E1E1E] transition-all"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Truck className="size-5 text-[#D4A574]" />
            Receive Delivery
          </h2>
          <p className="text-xs text-[#999] mt-0.5">
            {po.poNumber} &middot; {po.supplierName}
          </p>
        </div>
      </div>

      {/* All received banner */}
      {allReceived && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500/10
          border border-emerald-500/20 animate-[fadeIn_200ms_ease-out]">
          <CheckCircle2 className="size-5 text-emerald-400" />
          <span className="text-sm text-emerald-400 font-medium">
            All items received. Stock levels have been updated.
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Lines */}
      <div className="space-y-3">
        {lines.map((line, idx) => {
          const data = receiveData[line.lineId];
          const isReceived = line.lineStatus === "RECEIVED";
          const isLoading = loadingLine === line.lineId;

          // Discrepancy detection (only for received lines)
          const hasDiscrepancy = isReceived && line.receivedQty &&
            Number(line.receivedQty) !== Number(line.orderedQty);

          return (
            <div
              key={line.lineId}
              className={`rounded-xl border p-4 transition-all ${
                isReceived
                  ? "bg-emerald-500/5 border-emerald-500/15"
                  : "bg-[#161616]/80 backdrop-blur-sm border-[#2A2A2A] hover:border-[#3A3A3A]"
              }`}
              style={{ animationDelay: `${idx * 40}ms` }}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      {line.ingredientName}
                    </span>
                    <LineStatusBadge status={line.lineStatus} />
                  </div>
                  <div className="text-xs text-[#999] mt-0.5">
                    {line.ingredientCategory} &middot; Base unit: {line.baseUnit}
                  </div>
                </div>

                {/* Ordered qty badge */}
                <div className="text-right">
                  <div className="text-xs text-[#666]">Ordered</div>
                  <div className="text-sm font-mono text-[#CCC]">
                    {Number(line.orderedQty).toFixed(1)} {line.orderedUnit}
                  </div>
                </div>
              </div>

              {isReceived ? (
                /* Received summary */
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <span className="text-[#666] text-xs">Received:</span>{" "}
                    <span className={`font-mono ${hasDiscrepancy ? "text-amber-400" : "text-emerald-400"}`}>
                      {Number(line.receivedQty).toFixed(1)} {line.receivedUnit}
                    </span>
                  </div>
                  {line.unitCost && (
                    <div>
                      <span className="text-[#666] text-xs">Cost:</span>{" "}
                      <span className="text-[#CCC] font-mono">${Number(line.unitCost).toFixed(2)}</span>
                    </div>
                  )}
                  {hasDiscrepancy && (
                    <div className="flex items-center gap-1 text-amber-400 text-xs">
                      <AlertTriangle className="size-3" />
                      Discrepancy: {(Number(line.receivedQty!) - Number(line.orderedQty)).toFixed(1)}
                    </div>
                  )}
                </div>
              ) : (
                /* Receive form */
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-3">
                    <label className="block text-[10px] text-[#666] mb-0.5">Received qty</label>
                    <input
                      type="number"
                      value={data?.receivedQty ?? ""}
                      onChange={(e) => updateReceiveData(line.lineId, "receivedQty", e.target.value)}
                      min="0"
                      step="0.1"
                      className="w-full px-2 py-1.5 rounded-lg text-sm bg-[#1A1A1A] text-white
                        border border-[#2A2A2A] focus:border-[#D4A574]/40
                        focus:shadow-[0_0_6px_rgba(212,165,116,0.1)] outline-none"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[10px] text-[#666] mb-0.5">Unit</label>
                    <input
                      type="text"
                      value={data?.receivedUnit ?? ""}
                      onChange={(e) => updateReceiveData(line.lineId, "receivedUnit", e.target.value)}
                      className="w-full px-2 py-1.5 rounded-lg text-sm bg-[#1A1A1A] text-white
                        border border-[#2A2A2A] focus:border-[#D4A574]/40
                        focus:shadow-[0_0_6px_rgba(212,165,116,0.1)] outline-none"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-[10px] text-[#666] mb-0.5">Unit cost ($)</label>
                    <input
                      type="number"
                      value={data?.unitCost ?? ""}
                      onChange={(e) => updateReceiveData(line.lineId, "unitCost", e.target.value)}
                      min="0"
                      step="0.01"
                      className="w-full px-2 py-1.5 rounded-lg text-sm bg-[#1A1A1A] text-white
                        border border-[#2A2A2A] focus:border-[#D4A574]/40
                        focus:shadow-[0_0_6px_rgba(212,165,116,0.1)] outline-none"
                    />
                  </div>
                  <div className="col-span-3">
                    <button
                      onClick={() => handleReceive(line.lineId)}
                      disabled={isLoading}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg
                        text-xs font-medium bg-emerald-500/15 text-emerald-400
                        hover:bg-emerald-500/25 disabled:opacity-50 transition-all"
                    >
                      {isLoading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      Confirm
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary footer */}
      <div className="flex items-center justify-between px-4 py-3 rounded-xl
        bg-[#161616]/60 border border-[#2A2A2A]">
        <div className="text-sm text-[#999]">
          <span className="text-emerald-400 font-medium">{receivedLines.length}</span>
          {" / "}
          <span className="text-white">{lines.length}</span>
          {" lines received"}
        </div>
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg text-sm font-medium
            bg-[#1E1E1E] text-white border border-[#2A2A2A]
            hover:border-[#3A3A3A] transition-all"
        >
          {allReceived ? "Done" : "Back to Orders"}
        </button>
      </div>
    </div>
  );
}

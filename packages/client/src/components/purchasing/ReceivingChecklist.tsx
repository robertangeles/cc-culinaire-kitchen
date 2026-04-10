/**
 * @module components/purchasing/ReceivingChecklist
 *
 * Mobile-first delivery receiving checklist.
 * UX non-negotiables from brief:
 * - Default state: fully received (no input needed for perfect delivery)
 * - Every interaction completable with one thumb on a phone
 * - Confirm Receipt button pinned at bottom, always visible
 * - For a perfect delivery: 3 taps (open → scan → confirm)
 */

import { useState, useCallback, useEffect } from "react";
import { useReceiving, type LineAction, type ReceivingLine } from "../../hooks/useReceiving.js";
import { type PurchaseOrder } from "../../hooks/useInventory.js";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  DollarSign,
  ArrowRightLeft,
  Loader2,
  WifiOff,
  PartyPopper,
  Truck,
  ChevronDown,
  Camera,
} from "lucide-react";

interface Props {
  po: PurchaseOrder;
  onBack: () => void;
}

/* ── Line status config ──────────────────────────────────────── */

const LINE_STATUS_CONFIG: Record<string, { icon: typeof Check; color: string; bg: string; label: string }> = {
  RECEIVED:       { icon: CheckCircle2,    color: "text-emerald-400", bg: "bg-emerald-500/15", label: "Received" },
  SHORT:          { icon: AlertTriangle,   color: "text-amber-400",   bg: "bg-amber-500/15",   label: "Short" },
  REJECTED:       { icon: XCircle,         color: "text-red-400",     bg: "bg-red-500/15",     label: "Rejected" },
  PRICE_VARIANCE: { icon: DollarSign,      color: "text-blue-400",    bg: "bg-blue-500/15",    label: "Price Change" },
  SUBSTITUTED:    { icon: ArrowRightLeft,  color: "text-purple-400",  bg: "bg-purple-500/15",  label: "Substituted" },
};

const REJECTION_REASONS = [
  { value: "quality", label: "Quality not acceptable" },
  { value: "damaged", label: "Damaged packaging" },
  { value: "temperature", label: "Wrong temperature" },
  { value: "expired", label: "Expired" },
  { value: "other", label: "Other" },
];

export default function ReceivingChecklist({ po, onBack }: Props) {
  const {
    sessionData, isLoading, isSyncing, isOffline, error,
    discrepancyCount, isPerfectDelivery,
    startSession, actionLine, confirmReceipt, cancelSession,
  } = useReceiving();

  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<LineAction["status"] | null>(null);
  const [shortQty, setShortQty] = useState("");
  const [priceValue, setPriceValue] = useState("");
  const [rejectionReason, setRejectionReason] = useState("quality");
  const [rejectionNote, setRejectionNote] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [successSupplier, setSuccessSupplier] = useState("");

  // Start session on mount
  useEffect(() => {
    if (!sessionData && po.storeLocationId) {
      startSession(po.poId, po.storeLocationId).catch(() => {});
    }
  }, [po.poId, po.storeLocationId, sessionData, startSession]);

  const handleActionSelect = useCallback((lineId: string, action: LineAction["status"]) => {
    if (action === "RECEIVED") {
      // Reset to received — one tap
      actionLine(lineId, { status: "RECEIVED" });
      setActiveLineId(null);
      setActionType(null);
      return;
    }
    setActiveLineId(lineId);
    setActionType(action);
    setShortQty("");
    setPriceValue("");
    setRejectionReason("quality");
    setRejectionNote("");
  }, [actionLine]);

  const handleSubmitAction = useCallback(async () => {
    if (!activeLineId || !actionType) return;

    const input: LineAction = { status: actionType };

    if (actionType === "SHORT") {
      input.receivedQty = shortQty;
    }
    if (actionType === "PRICE_VARIANCE") {
      input.actualUnitCost = priceValue;
    }
    if (actionType === "REJECTED") {
      input.rejectionReason = rejectionReason;
      input.rejectionNote = rejectionNote || undefined;
    }

    await actionLine(activeLineId, input);
    setActiveLineId(null);
    setActionType(null);
  }, [activeLineId, actionType, shortQty, priceValue, rejectionReason, rejectionNote, actionLine]);

  const handleConfirm = useCallback(async () => {
    try {
      const result = await confirmReceipt();
      if (result.isPerfectDelivery) {
        setSuccessSupplier(po.supplierName ?? "Supplier");
        setShowSuccess(true);
        setTimeout(() => {
          setShowSuccess(false);
          onBack();
        }, 2500);
      } else {
        onBack();
      }
    } catch {
      // Error handled by hook
    }
  }, [confirmReceipt, po.supplierName, onBack]);

  const handleCancelSession = useCallback(async () => {
    if (!confirm("Cancel receiving? Changes will be lost.")) return;
    await cancelSession();
    onBack();
  }, [cancelSession, onBack]);

  // ── Loading state ──────────────────────────────────────────────
  if (isLoading || !sessionData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-[fadeIn_200ms_ease-out]">
        <Loader2 className="size-8 text-[#D4A574] animate-spin mb-4" />
        <p className="text-[#999] text-sm">Loading delivery...</p>
      </div>
    );
  }

  // ── Perfect delivery celebration ───────────────────────────────
  if (showSuccess) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm
        animate-[fadeIn_200ms_ease-out]">
        <div className="text-center animate-[fadeInUp_400ms_ease-out]">
          <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-emerald-500/20
            flex items-center justify-center border-2 border-emerald-500/40
            shadow-[0_0_40px_rgba(16,185,129,0.3)] animate-[pulse_1s_ease-in-out_infinite]">
            <PartyPopper className="size-12 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Perfect Delivery!</h2>
          <p className="text-emerald-400 text-lg">{successSupplier}</p>
        </div>
      </div>
    );
  }

  const lines = sessionData.lines;

  return (
    <div className="flex flex-col h-full animate-[fadeInUp_200ms_ease-out]">
      {/* Header — sticky */}
      <div className="sticky top-0 z-10 bg-[#0A0A0A]/95 backdrop-blur-sm border-b border-[#2A2A2A] px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={handleCancelSession} className="text-[#999] hover:text-white transition-all">
            <ArrowLeft className="size-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-semibold text-sm truncate">
              Receiving: {po.poNumber}
            </h2>
            <div className="flex items-center gap-2 text-xs text-[#999]">
              <span>{po.supplierName}</span>
              {isOffline && (
                <span className="flex items-center gap-1 text-amber-400">
                  <WifiOff className="size-3" /> Offline
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-[#999]">{lines.length} items</div>
            {discrepancyCount > 0 && (
              <div className="text-xs text-amber-400">{discrepancyCount} issue{discrepancyCount !== 1 ? "s" : ""}</div>
            )}
          </div>
        </div>
      </div>

      {/* Line items — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 pb-24">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-3">
            {error}
          </div>
        )}

        {lines.map((line, idx) => {
          const config = LINE_STATUS_CONFIG[line.status] ?? LINE_STATUS_CONFIG.RECEIVED;
          const Icon = config.icon;
          const isActive = activeLineId === line.receivingLineId;

          return (
            <div
              key={line.receivingLineId}
              className={`rounded-xl border transition-all ${
                isActive
                  ? "bg-[#1E1E1E] border-[#D4A574]/30 shadow-[0_0_16px_rgba(212,165,116,0.1)]"
                  : "bg-[#161616]/80 border-[#2A2A2A] hover:border-[#3A3A3A]"
              }`}
              style={{ animationDelay: `${idx * 30}ms` }}
            >
              {/* Line row — tap to toggle action sheet */}
              <button
                onClick={() => {
                  if (isActive) {
                    setActiveLineId(null);
                    setActionType(null);
                  } else {
                    setActiveLineId(line.receivingLineId);
                    setActionType(null);
                  }
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                {/* Status icon */}
                <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${config.bg}`}>
                  <Icon className={`size-4 ${config.color}`} />
                </div>

                {/* Item info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white font-medium truncate">
                    {line.ingredientName ?? "Unknown item"}
                  </div>
                  <div className="text-xs text-[#999]">
                    {Number(line.orderedQty).toFixed(1)} {line.orderedUnit}
                    {line.status !== "RECEIVED" && (
                      <span className={`ml-2 ${config.color}`}>
                        {config.label}: {Number(line.receivedQty).toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Expand indicator */}
                <ChevronDown className={`size-4 text-[#666] transition-transform ${isActive ? "rotate-180" : ""}`} />
              </button>

              {/* Action sheet — slides up from the line */}
              {isActive && (
                <div className="border-t border-[#2A2A2A] px-4 py-3 animate-[fadeIn_150ms_ease-out]">
                  {/* Action type selector */}
                  {!actionType && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleActionSelect(line.receivingLineId, "RECEIVED")}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium
                          bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-all"
                      >
                        <CheckCircle2 className="size-4" /> All Good
                      </button>
                      <button
                        onClick={() => handleActionSelect(line.receivingLineId, "SHORT")}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium
                          bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-all"
                      >
                        <AlertTriangle className="size-4" /> Short
                      </button>
                      <button
                        onClick={() => handleActionSelect(line.receivingLineId, "REJECTED")}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium
                          bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-all"
                      >
                        <XCircle className="size-4" /> Reject
                      </button>
                      <button
                        onClick={() => handleActionSelect(line.receivingLineId, "PRICE_VARIANCE")}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium
                          bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-all"
                      >
                        <DollarSign className="size-4" /> Price Change
                      </button>
                    </div>
                  )}

                  {/* SHORT input */}
                  {actionType === "SHORT" && (
                    <div className="space-y-3">
                      <label className="block text-xs text-[#999]">Quantity actually received</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={shortQty}
                        onChange={(e) => setShortQty(e.target.value)}
                        placeholder={`Ordered: ${Number(line.orderedQty).toFixed(1)}`}
                        className="w-full rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-white px-3 py-2.5 text-sm
                          focus:outline-none focus:border-[#D4A574]/50"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button onClick={() => setActionType(null)}
                          className="flex-1 py-2 rounded-lg text-xs text-[#999] bg-[#1A1A1A]">Back</button>
                        <button onClick={handleSubmitAction}
                          disabled={!shortQty || Number(shortQty) >= Number(line.orderedQty)}
                          className="flex-1 py-2 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-400
                            disabled:opacity-40 disabled:cursor-not-allowed">
                          Confirm Short
                        </button>
                      </div>
                    </div>
                  )}

                  {/* REJECTED input */}
                  {actionType === "REJECTED" && (
                    <div className="space-y-3">
                      <label className="block text-xs text-[#999]">Reason</label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {REJECTION_REASONS.map((r) => (
                          <button
                            key={r.value}
                            onClick={() => setRejectionReason(r.value)}
                            className={`px-3 py-2 rounded-lg text-xs transition-all ${
                              rejectionReason === r.value
                                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                : "bg-[#1A1A1A] text-[#999] border border-transparent"
                            }`}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                      <input
                        value={rejectionNote}
                        onChange={(e) => setRejectionNote(e.target.value)}
                        placeholder="Optional note..."
                        className="w-full rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-white px-3 py-2 text-sm
                          focus:outline-none focus:border-[#D4A574]/50 placeholder:text-[#666]"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => setActionType(null)}
                          className="flex-1 py-2 rounded-lg text-xs text-[#999] bg-[#1A1A1A]">Back</button>
                        <button onClick={handleSubmitAction}
                          className="flex-1 py-2 rounded-lg text-xs font-medium bg-red-500/15 text-red-400">
                          Reject Item
                        </button>
                      </div>
                    </div>
                  )}

                  {/* PRICE_VARIANCE input */}
                  {actionType === "PRICE_VARIANCE" && (
                    <div className="space-y-3">
                      <label className="block text-xs text-[#999]">
                        Invoice price (PO price: ${line.actualUnitCost ? Number(line.actualUnitCost).toFixed(2) : "N/A"})
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={priceValue}
                        onChange={(e) => setPriceValue(e.target.value)}
                        placeholder="Actual price per unit"
                        className="w-full rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-white px-3 py-2.5 text-sm
                          focus:outline-none focus:border-[#D4A574]/50"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button onClick={() => setActionType(null)}
                          className="flex-1 py-2 rounded-lg text-xs text-[#999] bg-[#1A1A1A]">Back</button>
                        <button onClick={handleSubmitAction}
                          disabled={!priceValue}
                          className="flex-1 py-2 rounded-lg text-xs font-medium bg-blue-500/15 text-blue-400
                            disabled:opacity-40 disabled:cursor-not-allowed">
                          Log Price Change
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Confirm Receipt — pinned at bottom */}
      <div className="sticky bottom-0 z-10 p-4 bg-[#0A0A0A]/95 backdrop-blur-sm border-t border-[#2A2A2A]">
        <button
          onClick={handleConfirm}
          disabled={isSyncing}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold
            bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A]
            hover:shadow-[0_0_20px_rgba(212,165,116,0.3)] transition-all
            disabled:opacity-60 disabled:cursor-not-allowed
            active:scale-[0.98]"
        >
          {isSyncing ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <>
              <Check className="size-5" />
              Confirm Receipt
              {discrepancyCount > 0 && (
                <span className="ml-1 px-2 py-0.5 rounded-full bg-black/20 text-xs">
                  {discrepancyCount} issue{discrepancyCount !== 1 ? "s" : ""}
                </span>
              )}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

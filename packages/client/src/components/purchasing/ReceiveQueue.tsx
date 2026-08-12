/**
 * @module components/purchasing/ReceiveQueue
 *
 * Shows SENT POs awaiting delivery receipt. Quick access to start receiving.
 */

import { useState, useCallback } from "react";
import { useLocation } from "../../context/LocationContext.js";
import { usePurchaseOrders, type PurchaseOrder } from "../../hooks/useInventory.js";
import ReceivingChecklist from "./ReceivingChecklist.js";
import { Package, Truck, Clock, Loader2, Send } from "lucide-react";

export default function ReceiveQueue({ onChanged }: { onChanged?: () => void }) {
  const { selectedLocationId } = useLocation();
  const { pos, isLoading, getDetail, refresh } = usePurchaseOrders(selectedLocationId);
  const [receivePO, setReceivePO] = useState<PurchaseOrder | null>(null);

  const sentPOs = pos.filter((p) => p.status === "SENT" || p.status === "RECEIVING");

  const [startError, setStartError] = useState<string | null>(null);

  const handleStartReceiving = useCallback(async (poId: string) => {
    setStartError(null);
    try {
      const detail = await getDetail(poId);
      if (detail) setReceivePO(detail);
    } catch (e) {
      // getDetail reports the real reason now; silently swallowing it left the
      // operator tapping a button that appeared to do nothing.
      setStartError(e instanceof Error ? e.message : "Couldn't open this delivery.");
    }
  }, [getDetail]);

  if (receivePO) {
    return (
      <ReceivingChecklist
        po={receivePO}
        onBack={() => {
          setReceivePO(null);
          // Opening a delivery moves the PO to RECEIVING, and confirming moves it
          // to RECEIVED/PARTIAL_RECEIVED — neither of which the queue sees without
          // a refetch, so a received delivery lingered here until a page reload.
          refresh();
          onChanged?.();
        }}
      />
    );
  }

  return (
    <div className="space-y-4 animate-[fadeInUp_200ms_ease-out]">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Truck className="size-5 text-gold" />
          Deliveries to Receive
        </h2>
      </div>

      {startError && (
        <p className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          {startError}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 text-gold animate-spin" />
        </div>
      ) : sentPOs.length === 0 ? (
        <div className="text-center py-16 animate-[fadeIn_300ms_ease-out]">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-dark-100/60 backdrop-blur-sm
            flex items-center justify-center border border-dark-200
            shadow-[0_0_20px_var(--color-gold-glow)]">
            <Package className="size-8 text-gold/60" />
          </div>
          <p className="text-dark-600 text-sm">No deliveries waiting to be received.</p>
          <p className="text-dark-500 text-xs mt-1">Sent purchase orders will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sentPOs.map((po, idx) => (
            <div
              key={po.poId}
              className="rounded-xl bg-dark-50/80 backdrop-blur-sm border border-dark-200
                hover:border-gold/30 hover:shadow-[0_0_16px_var(--color-gold-glow)]
                transition-all cursor-pointer"
              style={{ animationDelay: `${idx * 40}ms` }}
              onClick={() => handleStartReceiving(po.poId)}
            >
              <div className="flex items-center gap-4 px-4 py-4">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
                  <Truck className="size-5 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-medium text-white">{po.poNumber}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-400">
                      {po.status === "RECEIVING" ? "In Progress" : "Ready"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-dark-600">
                    <span>{po.supplierName}</span>
                    <span className="text-[#333]">|</span>
                    <span>{po.lineCount} item{po.lineCount !== 1 ? "s" : ""}</span>
                    {po.expectedDeliveryDate && (
                      <>
                        <span className="text-[#333]">|</span>
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          Expected {new Date(po.expectedDeliveryDate).toLocaleDateString()}
                        </span>
                      </>
                    )}
                  </div>
                  {(po.sentAt || po.createdByUserName) && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-dark-500">
                      <Send className="size-3" />
                      {po.sentAt
                        ? `Sent ${new Date(po.sentAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`
                        : "Not sent yet"}
                      {po.createdByUserName && <span>· ordered by {po.createdByUserName}</span>}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {po.totalValue && (
                    <div className="text-sm font-medium text-white">${Number(po.totalValue).toFixed(2)}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

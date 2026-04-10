/**
 * @module components/purchasing/ApprovalQueue
 *
 * HQ admin view of POs pending approval, sorted by wait time.
 * Amber >24h, red >48h.
 */

import { useState, useCallback } from "react";
import { useLocation } from "../../context/LocationContext.js";
import { usePurchaseOrders, type PurchaseOrder } from "../../hooks/useInventory.js";
import { Check, X, Clock, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";

export default function ApprovalQueue() {
  const { selectedLocationId } = useLocation();
  const { pos, isLoading, approvePO, rejectPO } = usePurchaseOrders(selectedLocationId);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const pendingPOs = pos
    .filter((p) => p.status === "PENDING_APPROVAL")
    .sort((a, b) => {
      const aTime = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
      const bTime = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
      return aTime - bTime; // oldest first
    });

  const handleApprove = useCallback(async (poId: string) => {
    if (!confirm("Approve this purchase order?")) return;
    try {
      await approvePO(poId);
    } catch (err: any) {
      alert(err.message);
    }
  }, [approvePO]);

  const handleReject = useCallback(async () => {
    if (!rejectingId || !rejectReason.trim()) return;
    try {
      await rejectPO(rejectingId, rejectReason.trim());
      setRejectingId(null);
      setRejectReason("");
    } catch (err: any) {
      alert(err.message);
    }
  }, [rejectPO, rejectingId, rejectReason]);

  function getWaitTime(submittedAt: string | null) {
    if (!submittedAt) return null;
    const hours = Math.round((Date.now() - new Date(submittedAt).getTime()) / 3600000);
    return hours;
  }

  function getWaitColor(hours: number | null) {
    if (!hours) return "text-[#999]";
    if (hours > 48) return "text-red-400";
    if (hours > 24) return "text-amber-400";
    return "text-[#999]";
  }

  return (
    <div className="space-y-4 animate-[fadeInUp_200ms_ease-out]">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <ShieldCheck className="size-5 text-[#D4A574]" />
          Pending Approvals
        </h2>
        {pendingPOs.length > 0 && (
          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-[#0A0A0A]">
            {pendingPOs.length}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 text-[#D4A574] animate-spin" />
        </div>
      ) : pendingPOs.length === 0 ? (
        <div className="text-center py-16 animate-[fadeIn_300ms_ease-out]">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#1E1E1E]/60 backdrop-blur-sm
            flex items-center justify-center border border-[#2A2A2A]
            shadow-[0_0_20px_rgba(212,165,116,0.08)]">
            <ShieldCheck className="size-8 text-emerald-400/60" />
          </div>
          <p className="text-[#999] text-sm">No purchase orders awaiting approval.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pendingPOs.map((po, idx) => {
            const waitHours = getWaitTime(po.submittedAt);
            const waitColor = getWaitColor(waitHours);

            return (
              <div
                key={po.poId}
                className="rounded-xl bg-[#161616]/80 backdrop-blur-sm border border-[#2A2A2A]
                  hover:border-[#3A3A3A] transition-all"
                style={{ animationDelay: `${idx * 40}ms` }}
              >
                <div className="flex items-center gap-4 px-4 py-4">
                  {/* Wait indicator */}
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    waitHours && waitHours > 48 ? "bg-red-500/15" :
                    waitHours && waitHours > 24 ? "bg-amber-500/15" : "bg-[#1E1E1E]"
                  }`}>
                    {waitHours && waitHours > 24 ? (
                      <AlertTriangle className={`size-5 ${waitColor}`} />
                    ) : (
                      <Clock className="size-5 text-amber-400" />
                    )}
                  </div>

                  {/* PO info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-medium text-white">{po.poNumber}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-[#999]">
                      <span>{po.supplierName}</span>
                      <span className="text-[#333]">|</span>
                      <span>{po.locationName}</span>
                      <span className="text-[#333]">|</span>
                      <span>{po.lineCount} item{po.lineCount !== 1 ? "s" : ""}</span>
                    </div>
                    {waitHours !== null && (
                      <div className={`flex items-center gap-1 mt-1 text-xs ${waitColor}`}>
                        <Clock className="size-3" />
                        Waiting {waitHours}h
                        {po.createdByUserName && <span className="text-[#666]">· by {po.createdByUserName}</span>}
                      </div>
                    )}
                  </div>

                  {/* Amount + actions */}
                  <div className="flex items-center gap-3 shrink-0">
                    {po.totalValue && (
                      <div className="text-sm font-semibold text-white mr-2">
                        ${Number(po.totalValue).toFixed(2)}
                      </div>
                    )}
                    <button
                      onClick={() => handleApprove(po.poId)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                        bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-all"
                    >
                      <Check className="size-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => { setRejectingId(po.poId); setRejectReason(""); }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                        bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                    >
                      <X className="size-3.5" /> Reject
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reject modal */}
      {rejectingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1E1E1E] border border-[#2A2A2A] rounded-xl p-6 w-full max-w-md
            shadow-[0_8px_32px_rgba(0,0,0,0.5)] animate-[fadeInUp_200ms_ease-out]">
            <h3 className="text-white font-semibold mb-3">Reject Purchase Order</h3>
            <p className="text-sm text-[#999] mb-4">
              Provide a reason so the location can amend and resubmit.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection..."
              rows={3}
              className="w-full rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-white px-3 py-2 text-sm
                focus:outline-none focus:border-[#D4A574]/50 placeholder:text-[#666]"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setRejectingId(null)}
                className="px-4 py-2 rounded-lg text-sm text-[#999] hover:text-white transition-all">
                Cancel
              </button>
              <button onClick={handleReject} disabled={!rejectReason.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/15 text-red-400
                  hover:bg-red-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                Reject PO
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

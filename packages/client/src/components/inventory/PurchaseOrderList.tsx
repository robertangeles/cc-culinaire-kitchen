/**
 * @module components/inventory/PurchaseOrderList
 *
 * Lists purchase orders with status badges, expandable line details,
 * approval actions, clone, PDF download, and status filtering.
 * Entry point for the PO workflow tab.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { useLocation } from "../../context/LocationContext.js";
import {
  usePurchaseOrders,
  useSuppliers,
  useLocationIngredients,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from "../../hooks/useInventory.js";
import PurchaseOrderForm from "./PurchaseOrderForm.js";
import DeliveryReceiving from "./DeliveryReceiving.js";
import ReceivingChecklist from "../purchasing/ReceivingChecklist.js";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Package,
  Loader2,
  Filter,
  FileText,
  Send,
  XCircle,
  Truck,
  Check,
  X,
  Copy,
  Download,
  Clock,
  AlertTriangle,
} from "lucide-react";

/* ── Status badge config ──────────────────────────────────────── */

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT:              { bg: "bg-[#333]/60",           text: "text-[#999]",     label: "Draft" },
  PENDING_APPROVAL:   { bg: "bg-amber-500/15",        text: "text-amber-400",  label: "Pending Approval" },
  SENT:               { bg: "bg-blue-500/15",          text: "text-blue-400",   label: "Sent" },
  RECEIVING:          { bg: "bg-purple-500/15",        text: "text-purple-400", label: "Receiving" },
  SUBMITTED:          { bg: "bg-amber-500/15",        text: "text-amber-400",  label: "Submitted" },
  PARTIAL_RECEIVED:   { bg: "bg-sky-500/15",           text: "text-sky-400",    label: "Partial" },
  PARTIALLY_RECEIVED: { bg: "bg-sky-500/15",          text: "text-sky-400",    label: "Partial" },
  RECEIVED:           { bg: "bg-emerald-500/15",      text: "text-emerald-400",label: "Received" },
  CANCELLED:          { bg: "bg-red-500/15",          text: "text-red-400",    label: "Cancelled" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

/* ── Filter statuses ──────────────────────────────────────────── */

const FILTER_OPTIONS = [
  { key: "", label: "All" },
  { key: "DRAFT", label: "Draft" },
  { key: "PENDING_APPROVAL", label: "Pending" },
  { key: "SENT", label: "Sent" },
  { key: "RECEIVING", label: "Receiving" },
  { key: "RECEIVED", label: "Received" },
  { key: "CANCELLED", label: "Cancelled" },
];

/* ── Main component ──────────────────────────────────────────── */

type View = "list" | "create" | "receive" | "receive-new";

export default function PurchaseOrderList() {
  const { selectedLocationId } = useLocation();
  const {
    pos, isLoading, refresh, submitPO, cancelPO,
    approvePO, rejectPO, clonePO, downloadPdf, getDetail,
  } = usePurchaseOrders(selectedLocationId);
  const { suppliers } = useSuppliers();
  const { items: ingredients } = useLocationIngredients(selectedLocationId);
  const ingMap = useMemo(() => {
    const m = new Map<string, typeof ingredients[0]>();
    ingredients.forEach((i) => m.set(i.ingredientId, i));
    return m;
  }, [ingredients]);

  const [view, setView] = useState<View>("list");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, PurchaseOrder>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [receivePO, setReceivePO] = useState<PurchaseOrder | null>(null);
  const [rejectModalPO, setRejectModalPO] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const filtered = statusFilter
    ? pos.filter((p) => p.status === statusFilter)
    : pos;

  const toggleExpand = useCallback(async (poId: string) => {
    if (expandedId === poId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(poId);
    if (!detailCache[poId]) {
      setLoadingDetail(poId);
      const detail = await getDetail(poId);
      if (detail) setDetailCache((prev) => ({ ...prev, [poId]: detail }));
      setLoadingDetail(null);
    }
  }, [expandedId, detailCache, getDetail]);

  const handleSubmit = useCallback(async (poId: string) => {
    try {
      await submitPO(poId);
      setDetailCache((prev) => {
        const copy = { ...prev };
        delete copy[poId];
        return copy;
      });
    } catch (err: any) {
      alert(err.message);
    }
  }, [submitPO]);

  const handleCancel = useCallback(async (poId: string) => {
    if (!confirm("Cancel this purchase order?")) return;
    try {
      await cancelPO(poId);
      setDetailCache((prev) => {
        const copy = { ...prev };
        delete copy[poId];
        return copy;
      });
    } catch (err: any) {
      alert(err.message);
    }
  }, [cancelPO]);

  const handleReceive = useCallback(async (poId: string) => {
    const detail = detailCache[poId] ?? await getDetail(poId);
    if (detail) {
      setReceivePO(detail);
      setView("receive");
    }
  }, [detailCache, getDetail]);

  const handleCreated = useCallback(() => {
    setView("list");
    refresh();
  }, [refresh]);

  const handleReceiveDone = useCallback(() => {
    setView("list");
    setReceivePO(null);
    setDetailCache({});
    refresh();
  }, [refresh]);

  const handleApprove = useCallback(async (poId: string) => {
    if (!confirm("Approve this purchase order?")) return;
    try {
      await approvePO(poId);
      setDetailCache((prev) => { const c = { ...prev }; delete c[poId]; return c; });
    } catch (err: any) {
      alert(err.message);
    }
  }, [approvePO]);

  const handleReject = useCallback(async () => {
    if (!rejectModalPO || !rejectReason.trim()) return;
    try {
      await rejectPO(rejectModalPO, rejectReason.trim());
      setRejectModalPO(null);
      setRejectReason("");
      setDetailCache((prev) => { const c = { ...prev }; delete c[rejectModalPO]; return c; });
    } catch (err: any) {
      alert(err.message);
    }
  }, [rejectPO, rejectModalPO, rejectReason]);

  const handleClone = useCallback(async (poId: string) => {
    if (!selectedLocationId) return;
    try {
      const result = await clonePO(poId, selectedLocationId);
      if (result.skippedItems?.length > 0) {
        alert(`PO cloned. ${result.skippedItems.length} item(s) skipped (at or above par level).`);
      }
    } catch (err: any) {
      alert(err.message);
    }
  }, [clonePO, selectedLocationId]);

  const handleDownloadPdf = useCallback(async (poId: string) => {
    try {
      await downloadPdf(poId);
    } catch (err: any) {
      alert(err.message);
    }
  }, [downloadPdf]);

  const handleStartReceiving = useCallback(async (poId: string) => {
    const detail = detailCache[poId] ?? await getDetail(poId);
    if (detail) {
      setReceivePO(detail);
      setView("receive-new");
    }
  }, [detailCache, getDetail]);

  if (view === "create") {
    return <PurchaseOrderForm onBack={() => setView("list")} onCreated={handleCreated} />;
  }

  if (view === "receive" && receivePO) {
    return <DeliveryReceiving po={receivePO} onBack={handleReceiveDone} />;
  }

  if (view === "receive-new" && receivePO) {
    return <ReceivingChecklist po={receivePO} onBack={handleReceiveDone} />;
  }

  return (
    <div className="space-y-4 animate-[fadeInUp_200ms_ease-out]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <FileText className="size-5 text-[#D4A574]" />
          Purchase Orders
        </h2>
        <button
          onClick={() => setView("create")}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
            bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A]
            hover:shadow-[0_0_16px_rgba(212,165,116,0.3)] transition-all
            hover:-translate-y-0.5 active:translate-y-0"
        >
          <Plus className="size-4" />
          New PO
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Filter className="size-4 text-[#666]" />
        <div className="flex gap-1 p-0.5 rounded-lg bg-[#161616] border border-[#2A2A2A]">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                statusFilter === f.key
                  ? "bg-[#1E1E1E] text-white shadow-[0_0_8px_rgba(212,165,116,0.1)]"
                  : "text-[#999] hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 text-[#D4A574] animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 animate-[fadeIn_300ms_ease-out]">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#1E1E1E]/60 backdrop-blur-sm
            flex items-center justify-center border border-[#2A2A2A]
            shadow-[0_0_20px_rgba(212,165,116,0.08)]">
            <Package className="size-8 text-[#D4A574]/60" />
          </div>
          <p className="text-[#999] text-sm mb-4">
            {statusFilter ? "No purchase orders match this filter." : "No purchase orders yet."}
          </p>
          <button
            onClick={() => setView("create")}
            className="px-4 py-2 rounded-lg text-sm font-medium
              bg-[#1E1E1E] text-[#D4A574] border border-[#D4A574]/20
              hover:border-[#D4A574]/40 hover:shadow-[0_0_12px_rgba(212,165,116,0.15)] transition-all"
          >
            Create your first PO
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((po, idx) => (
            <div
              key={po.poId}
              className="rounded-xl bg-[#161616]/80 backdrop-blur-sm border border-[#2A2A2A]
                hover:border-[#3A3A3A] transition-all
                shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
              style={{ animationDelay: `${idx * 40}ms` }}
            >
              {/* PO row */}
              <button
                onClick={() => toggleExpand(po.poId)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                <span className="text-[#666]">
                  {expandedId === po.poId
                    ? <ChevronDown className="size-4" />
                    : <ChevronRight className="size-4" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-medium text-white">{po.poNumber}</span>
                    <StatusBadge status={po.status} />
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-[#999]">
                    <span>{po.supplierName ?? "Unknown supplier"}</span>
                    <span className="text-[#333]">|</span>
                    <span>{po.locationName}</span>
                    <span className="text-[#333]">|</span>
                    <span>{po.lineCount} item{po.lineCount !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {po.totalValue && (
                    <div className="text-sm font-medium text-white">
                      ${Number(po.totalValue).toFixed(2)}
                    </div>
                  )}
                  <div className="text-xs text-[#999]">
                    {po.createdDttm ? new Date(po.createdDttm).toLocaleDateString() : ""}
                  </div>
                  {po.status === "PENDING_APPROVAL" && po.submittedAt && (
                    <div className="flex items-center gap-1 text-xs text-amber-400 mt-0.5">
                      <Clock className="size-3" />
                      {(() => {
                        const hours = Math.round((Date.now() - new Date(po.submittedAt).getTime()) / 3600000);
                        return hours > 48
                          ? <span className="text-red-400">{hours}h waiting</span>
                          : hours > 24
                          ? <span className="text-amber-400">{hours}h waiting</span>
                          : <span>{hours}h waiting</span>;
                      })()}
                    </div>
                  )}
                </div>
              </button>

              {/* Expanded detail */}
              {expandedId === po.poId && (
                <div className="border-t border-[#2A2A2A] px-4 py-3 animate-[fadeIn_150ms_ease-out]">
                  {loadingDetail === po.poId ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="size-5 text-[#D4A574] animate-spin" />
                    </div>
                  ) : detailCache[po.poId]?.lines ? (
                    <>
                      {/* Lines table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-[#666] text-[10px] uppercase tracking-wider border-b border-[#1A1A1A]">
                              <th className="text-left py-2 font-medium">Item</th>
                              <th className="text-center py-2 font-medium">UOM</th>
                              <th className="text-right py-2 font-medium">Stock</th>
                              <th className="text-right py-2 font-medium">Par</th>
                              <th className="text-right py-2 font-medium">Ordered</th>
                              <th className="text-right py-2 font-medium">Received</th>
                              <th className="text-right py-2 font-medium">Cost</th>
                              <th className="text-center py-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailCache[po.poId].lines!.map((line) => {
                              const ing = ingMap.get(line.ingredientId);
                              const stock = Number(ing?.currentQty ?? 0);
                              const par = Number(ing?.parLevel ?? ing?.orgParLevel ?? 0);
                              const isLow = par > 0 && stock < par;
                              return (
                              <tr key={line.lineId} className="border-b border-[#1A1A1A]/50">
                                <td className="py-2 text-white">{line.ingredientName}</td>
                                <td className="py-2 text-center text-xs text-[#666]">{line.baseUnit ?? line.orderedUnit}</td>
                                <td className={`py-2 text-right text-xs ${isLow ? "text-amber-400 font-medium" : "text-[#666]"}`}>
                                  {stock.toFixed(1)}
                                </td>
                                <td className="py-2 text-right text-xs text-[#555]">
                                  {par > 0 ? par.toFixed(1) : "—"}
                                </td>
                                <td className="py-2 text-right text-[#CCC]">
                                  {Number(line.orderedQty).toFixed(1)}
                                </td>
                                <td className="py-2 text-right text-[#CCC]">
                                  {line.receivedQty ? Number(line.receivedQty).toFixed(1) : "—"}
                                </td>
                                <td className="py-2 text-right text-[#CCC]">
                                  {line.unitCost ? `$${Number(line.unitCost).toFixed(2)}` : "—"}
                                </td>
                                <td className="py-2 text-center">
                                  <StatusBadge status={line.lineStatus} />
                                </td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Notes */}
                      {po.notes && (
                        <div className="mt-3 text-xs text-[#999] bg-[#1A1A1A] rounded-lg px-3 py-2">
                          {po.notes}
                        </div>
                      )}

                      {/* Rejected reason banner */}
                      {po.rejectedReason && po.status === "DRAFT" && (
                        <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                          <AlertTriangle className="size-4 text-red-400 shrink-0 mt-0.5" />
                          <div>
                            <div className="text-xs font-medium text-red-400">Rejected by HQ</div>
                            <div className="text-xs text-red-300/80 mt-0.5">{po.rejectedReason}</div>
                          </div>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#1A1A1A] flex-wrap">
                        {po.status === "DRAFT" && (
                          <>
                            <button
                              onClick={() => handleSubmit(po.poId)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A]
                                hover:shadow-[0_0_12px_rgba(212,165,116,0.3)] transition-all"
                            >
                              <Send className="size-3" /> Submit
                            </button>
                            <button
                              onClick={() => handleCancel(po.poId)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                            >
                              <XCircle className="size-3" /> Cancel
                            </button>
                          </>
                        )}
                        {po.status === "PENDING_APPROVAL" && (
                          <>
                            <button
                              onClick={() => handleApprove(po.poId)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-all"
                            >
                              <Check className="size-3" /> Approve
                            </button>
                            <button
                              onClick={() => { setRejectModalPO(po.poId); setRejectReason(""); }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                            >
                              <X className="size-3" /> Reject
                            </button>
                          </>
                        )}
                        {po.status === "SENT" && (
                          <button
                            onClick={() => handleStartReceiving(po.poId)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                              bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-all"
                          >
                            <Truck className="size-3" /> Receive Delivery
                          </button>
                        )}
                        {/* Common actions for non-terminal statuses */}
                        {!["RECEIVED", "PARTIAL_RECEIVED", "PARTIALLY_RECEIVED", "CANCELLED"].includes(po.status) && (
                          <>
                            <button
                              onClick={() => handleDownloadPdf(po.poId)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                bg-[#1E1E1E] text-[#999] hover:text-white transition-all"
                            >
                              <Download className="size-3" /> PDF
                            </button>
                          </>
                        )}
                        {["RECEIVED", "PARTIAL_RECEIVED", "PARTIALLY_RECEIVED"].includes(po.status) && (
                          <button
                            onClick={() => handleClone(po.poId)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                              bg-[#D4A574]/10 text-[#D4A574] hover:bg-[#D4A574]/20 transition-all"
                          >
                            <Copy className="size-3" /> Reorder
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-[#999] text-sm py-2">Failed to load details.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reject modal */}
      {rejectModalPO && (
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
                focus:outline-none focus:border-[#D4A574]/50 focus:shadow-[0_0_0_2px_rgba(212,165,116,0.15)]
                placeholder:text-[#666]"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setRejectModalPO(null)}
                className="px-4 py-2 rounded-lg text-sm text-[#999] hover:text-white transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectReason.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/15 text-red-400
                  hover:bg-red-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Reject PO
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

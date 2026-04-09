/**
 * @module components/inventory/PurchaseOrderList
 *
 * Lists purchase orders with status badges, expandable line details,
 * and status filtering. Entry point for the PO workflow tab.
 */

import { useState, useCallback, useEffect } from "react";
import { useLocation } from "../../context/LocationContext.js";
import {
  usePurchaseOrders,
  useSuppliers,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from "../../hooks/useInventory.js";
import PurchaseOrderForm from "./PurchaseOrderForm.js";
import DeliveryReceiving from "./DeliveryReceiving.js";
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
} from "lucide-react";

/* ── Status badge config ──────────────────────────────────────── */

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT:              { bg: "bg-[#333]/60",           text: "text-[#999]",     label: "Draft" },
  SUBMITTED:          { bg: "bg-amber-500/15",        text: "text-amber-400",  label: "Submitted" },
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
  { key: "SUBMITTED", label: "Submitted" },
  { key: "PARTIALLY_RECEIVED", label: "Partial" },
  { key: "RECEIVED", label: "Received" },
  { key: "CANCELLED", label: "Cancelled" },
];

/* ── Main component ──────────────────────────────────────────── */

type View = "list" | "create" | "receive";

export default function PurchaseOrderList() {
  const { selectedLocationId } = useLocation();
  const { pos, isLoading, refresh, submitPO, cancelPO } = usePurchaseOrders(selectedLocationId);
  const { suppliers } = useSuppliers();

  const [view, setView] = useState<View>("list");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, PurchaseOrder>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [receivePO, setReceivePO] = useState<PurchaseOrder | null>(null);
  const { getDetail } = usePurchaseOrders(selectedLocationId);

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

  if (view === "create") {
    return <PurchaseOrderForm onBack={() => setView("list")} onCreated={handleCreated} />;
  }

  if (view === "receive" && receivePO) {
    return <DeliveryReceiving po={receivePO} onBack={handleReceiveDone} />;
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
                  <div className="text-xs text-[#999]">
                    {new Date(po.createdDttm).toLocaleDateString()}
                  </div>
                  <div className="text-xs text-[#666]">{po.createdByUserName}</div>
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
                            <tr className="text-[#666] text-xs border-b border-[#1A1A1A]">
                              <th className="text-left py-2 font-medium">Item</th>
                              <th className="text-right py-2 font-medium">Ordered</th>
                              <th className="text-right py-2 font-medium">Received</th>
                              <th className="text-right py-2 font-medium">Cost</th>
                              <th className="text-center py-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailCache[po.poId].lines!.map((line) => (
                              <tr key={line.lineId} className="border-b border-[#1A1A1A]/50">
                                <td className="py-2 text-white">{line.ingredientName}</td>
                                <td className="py-2 text-right text-[#CCC]">
                                  {Number(line.orderedQty).toFixed(1)} {line.orderedUnit}
                                </td>
                                <td className="py-2 text-right text-[#CCC]">
                                  {line.receivedQty
                                    ? `${Number(line.receivedQty).toFixed(1)} ${line.receivedUnit}`
                                    : "-"}
                                </td>
                                <td className="py-2 text-right text-[#CCC]">
                                  {line.unitCost ? `$${Number(line.unitCost).toFixed(2)}` : "-"}
                                </td>
                                <td className="py-2 text-center">
                                  <StatusBadge status={line.lineStatus} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Notes */}
                      {po.notes && (
                        <div className="mt-3 text-xs text-[#999] bg-[#1A1A1A] rounded-lg px-3 py-2">
                          {po.notes}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#1A1A1A]">
                        {po.status === "DRAFT" && (
                          <>
                            <button
                              onClick={() => handleSubmit(po.poId)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-all"
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
                        {(po.status === "SUBMITTED" || po.status === "PARTIALLY_RECEIVED") && (
                          <button
                            onClick={() => handleReceive(po.poId)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                              bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-all"
                          >
                            <Truck className="size-3" /> Receive Delivery
                          </button>
                        )}
                        {po.status === "SUBMITTED" && (
                          <button
                            onClick={() => handleCancel(po.poId)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                              bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                          >
                            <XCircle className="size-3" /> Cancel
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
    </div>
  );
}

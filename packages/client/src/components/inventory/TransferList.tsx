/**
 * @module components/inventory/TransferList
 *
 * Displays outgoing and incoming inter-location transfers
 * with status badges, action buttons, and drill-down to detail.
 */

import { useState } from "react";
import { useLocation } from "../../context/LocationContext.js";
import { useTransfers, type Transfer } from "../../hooks/useInventory.js";
import {
  ArrowRightLeft,
  Plus,
  Send,
  PackageCheck,
  XCircle,
  Loader2,
  ArrowRight,
  ChevronRight,
  Inbox,
} from "lucide-react";
import TransferForm from "./TransferForm.js";
import TransferReceiving from "./TransferReceiving.js";

/* ── Status badge colors ──────────────────────────────────────── */

const STATUS_STYLES: Record<string, string> = {
  INITIATED: "bg-zinc-700/60 text-zinc-300 border-zinc-600/40",
  SENT: "bg-amber-900/40 text-amber-300 border-amber-600/30",
  RECEIVED: "bg-emerald-900/40 text-emerald-300 border-emerald-600/30",
  DISCREPANCY: "bg-red-900/40 text-red-300 border-red-600/30",
  CANCELLED: "bg-zinc-800/60 text-zinc-500 border-zinc-700/40",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[status] || STATUS_STYLES.INITIATED}`}
    >
      {status}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ── Transfer row — expandable with line items ───────────────── */

function TransferRow({
  transfer,
  isIncoming,
  onSend,
  onReceive,
  onCancel,
  sending,
}: {
  transfer: Transfer;
  isIncoming: boolean;
  onSend: (id: string) => void;
  onReceive: (id: string) => void;
  onCancel: (id: string) => void;
  sending: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const isBusy = sending === transfer.transferId;
  const isEditable = transfer.status === "INITIATED" && !isIncoming;

  async function toggleExpand() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!detail) {
      setLoadingDetail(true);
      try {
        const res = await fetch(`/api/inventory/transfers/${transfer.transferId}`, { credentials: "include" });
        if (res.ok) setDetail(await res.json());
      } catch { /* ignore */ }
      setLoadingDetail(false);
    }
  }

  return (
    <div className="rounded-xl bg-[#111]/60 border border-white/5 hover:border-[#D4A574]/15 transition-all overflow-hidden">
      {/* Header row — clickable */}
      <button
        onClick={toggleExpand}
        className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <ChevronRight size={14} className={`text-[#666] transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`} />
          <div className="flex items-center gap-1.5 text-sm text-[#ccc] truncate">
            <span className="font-medium text-white truncate">
              {transfer.fromLocationName || "Unknown"}
            </span>
            <ArrowRight size={14} className="text-[#555] flex-shrink-0" />
            <span className="font-medium text-white truncate">
              {transfer.toLocationName || "Unknown"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-[#888]">
            {transfer.lineCount} item{transfer.lineCount !== 1 ? "s" : ""}
          </span>
          <StatusBadge status={transfer.status} />
          <span className="text-xs text-[#888] w-28 text-right">
            {formatDate(transfer.createdDttm)}
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-white/5 px-4 py-3 space-y-3 animate-[fadeIn_150ms_ease-out]">
          {loadingDetail ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={16} className="animate-spin text-[#D4A574]" />
            </div>
          ) : detail?.lines ? (
            <>
              {/* Line items */}
              <div className="rounded-lg border border-[#1E1E1E] divide-y divide-[#1E1E1E]">
                <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.02]">
                  <span className="text-[10px] text-[#666] uppercase tracking-wider">Item</span>
                  <span className="text-[10px] text-[#666] uppercase tracking-wider">Quantity</span>
                </div>
                {(detail.lines as any[]).map((line: any) => (
                  <div key={line.lineId} className="flex items-center justify-between px-3 py-2">
                    <span className="text-sm text-[#ccc]">{line.ingredientName || line.ingredientId}</span>
                    <span className="text-sm text-white tabular-nums">
                      {Number(line.sentQty).toFixed(1)} {line.sentUnit}
                    </span>
                  </div>
                ))}
              </div>

              {/* Notes */}
              {detail.notes && (
                <p className="text-xs text-[#888] italic">Note: {detail.notes}</p>
              )}

              {/* Actions for INITIATED transfers */}
              {isEditable && (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); onSend(transfer.transferId); }}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] text-sm font-semibold hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Confirm Send
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onCancel(transfer.transferId); }}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition-colors disabled:opacity-50 border border-red-500/20"
                  >
                    <XCircle size={14} />
                    Cancel
                  </button>
                </div>
              )}

              {/* Receive action for incoming SENT */}
              {transfer.status === "SENT" && isIncoming && (
                <button
                  onClick={(e) => { e.stopPropagation(); onReceive(transfer.transferId); }}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 text-sm font-semibold hover:bg-emerald-500/20 transition-colors disabled:opacity-50 border border-emerald-500/20"
                >
                  {isBusy ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
                  Confirm Receipt
                </button>
              )}
            </>
          ) : (
            <p className="text-xs text-[#666] text-center py-2">No details available</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────── */

export default function TransferList() {
  const { selectedLocationId } = useLocation();
  const {
    transfers,
    pendingIncoming,
    isLoading,
    confirmSent,
    cancel,
    refresh,
  } = useTransfers(selectedLocationId);

  const [showForm, setShowForm] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  const outgoing = transfers.filter(
    (t) => t.fromLocationId === selectedLocationId,
  );
  const incoming = transfers.filter(
    (t) => t.toLocationId === selectedLocationId,
  );

  async function handleSend(id: string) {
    setSending(id);
    try {
      await confirmSent(id);
    } catch {
      /* error handled by hook */
    } finally {
      setSending(null);
    }
  }

  async function handleCancel(id: string) {
    setSending(id);
    try {
      await cancel(id);
    } catch {
      /* error handled by hook */
    } finally {
      setSending(null);
    }
  }

  if (showForm) {
    return (
      <TransferForm
        onClose={() => {
          setShowForm(false);
          refresh();
        }}
      />
    );
  }

  if (receivingId) {
    return (
      <TransferReceiving
        transferId={receivingId}
        onClose={() => {
          setReceivingId(null);
          refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <ArrowRightLeft size={20} className="text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Transfers</h2>
            <p className="text-xs text-zinc-500">Move stock between locations</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] text-sm font-semibold hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] active:scale-[0.98] transition-all"
        >
          <Plus size={16} />
          New Transfer
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-amber-400" />
        </div>
      ) : (
        <>
          {/* Pending incoming banner */}
          {pendingIncoming.length > 0 && (
            <div className="p-4 rounded-xl bg-amber-900/20 border border-amber-500/20 shadow-[0_0_12px_rgba(255,214,10,0.08)]">
              <div className="flex items-center gap-2 mb-3">
                <Inbox size={16} className="text-amber-400" />
                <span className="text-sm font-semibold text-amber-300">
                  {pendingIncoming.length} Incoming Transfer{pendingIncoming.length !== 1 ? "s" : ""} Awaiting Receipt
                </span>
              </div>
              <div className="space-y-2">
                {pendingIncoming.map((t) => (
                  <TransferRow
                    key={t.transferId}
                    transfer={t}
                    isIncoming
                    onSend={handleSend}
                    onReceive={(id) => setReceivingId(id)}
                    onCancel={handleCancel}
                    sending={sending}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Outgoing */}
          <div>
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Send size={14} />
              Outgoing
            </h3>
            {outgoing.length === 0 ? (
              <p className="text-sm text-zinc-500 py-4 text-center">No outgoing transfers</p>
            ) : (
              <div className="space-y-2">
                {outgoing.map((t) => (
                  <TransferRow
                    key={t.transferId}
                    transfer={t}
                    isIncoming={false}
                    onSend={handleSend}
                    onReceive={(id) => setReceivingId(id)}
                    onCancel={handleCancel}
                    sending={sending}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Incoming */}
          <div>
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <PackageCheck size={14} />
              Incoming
            </h3>
            {incoming.length === 0 ? (
              <p className="text-sm text-zinc-500 py-4 text-center">No incoming transfers</p>
            ) : (
              <div className="space-y-2">
                {incoming.map((t) => (
                  <TransferRow
                    key={t.transferId}
                    transfer={t}
                    isIncoming
                    onSend={handleSend}
                    onReceive={(id) => setReceivingId(id)}
                    onCancel={handleCancel}
                    sending={sending}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * @module components/inventory/CatalogRequestQueue
 *
 * HQ view of pending catalog item requests from locations.
 * Allows approving (with editable fields) or rejecting (with reason).
 */

import { useState, useEffect, useCallback } from "react";
import {
  Check, X, Loader2, Package, FileQuestion, Clock,
} from "lucide-react";
import {
  CATEGORIES, CATEGORY_LABELS, getItemTypeStyle,
  ITEM_TYPES, ITEM_TYPE_KEYS,
  type ItemTypeKey,
} from "@culinaire/shared";

const API = "/api/inventory";
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

const UNITS = ["kg", "g", "L", "mL", "each", "case", "dozen", "bunch", "bottle", "can", "bag", "box"];

interface CatalogRequest {
  id: string;
  ingredientName: string;
  ingredientCategory: string;
  baseUnit: string;
  countedQty: string | null;
  itemType: string;
  requestedByUserId: string;
  storeLocationId: string;
  locationName?: string;
  status: string;
  createdDttm: string;
}

export function CatalogRequestQueue() {
  const [requests, setRequests] = useState<CatalogRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [approveId, setApproveId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/catalog-requests/pending`, opts);
      if (res.ok) setRequests(await res.json());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 text-[#D4A574] animate-spin" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="text-center py-16 rounded-xl bg-[#161616] border border-[#2A2A2A]">
        <div className="relative inline-block mb-4">
          <Check className="size-10 text-emerald-400" />
          <div className="absolute inset-0 rounded-full bg-emerald-400/10 blur-xl" />
        </div>
        <p className="text-sm text-white font-medium mb-1">No pending requests</p>
        <p className="text-xs text-[#999]">
          All catalog requests have been reviewed. Check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-[fadeInUp_200ms_ease-out]">
      <div className="flex items-center gap-2 mb-2">
        <FileQuestion className="size-4 text-[#D4A574]" />
        <h3 className="text-sm font-semibold text-white">
          Pending Requests
        </h3>
        <span className="px-2 py-0.5 rounded-full bg-[#D4A574]/15 text-[#D4A574] text-[10px] font-semibold">
          {requests.length}
        </span>
      </div>

      {requests.map((req) => {
        const its = getItemTypeStyle(req.itemType);
        const isApproving = approveId === req.id;
        const isRejecting = rejectId === req.id;

        return (
          <div
            key={req.id}
            className="bg-[#111]/80 backdrop-blur-md border border-white/5 rounded-xl p-4 transition-all hover:border-white/10"
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="size-4 text-[#999] shrink-0" />
                  <span className="text-base font-semibold text-white truncate">
                    {req.ingredientName}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${its.bgClass} ${its.textClass}`}>
                    {its.label}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-[#999]">
                  <span>
                    Requested by: <span className="text-[#ccc]">{req.requestedByUserId.slice(0, 8)}...</span>
                  </span>
                  {req.locationName && (
                    <span>
                      Location: <span className="text-[#ccc]">{req.locationName}</span>
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {new Date(req.createdDttm).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              {!isApproving && !isRejecting && (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => { setApproveId(req.id); setRejectId(null); }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition-all"
                  >
                    <Check className="size-3" />
                    Approve
                  </button>
                  <button
                    onClick={() => { setRejectId(req.id); setApproveId(null); }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-all"
                  >
                    <X className="size-3" />
                    Reject
                  </button>
                </div>
              )}
            </div>

            {/* Detail chips */}
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-[#1E1E1E] text-[#999]">
                Category: {CATEGORY_LABELS[req.ingredientCategory] || req.ingredientCategory}
              </span>
              <span className="px-2 py-0.5 rounded bg-[#1E1E1E] text-[#999]">
                Unit: {req.baseUnit}
              </span>
              {req.countedQty && (
                <span className="px-2 py-0.5 rounded bg-[#1E1E1E] text-[#999]">
                  Counted: {Number(req.countedQty).toFixed(1)}
                </span>
              )}
            </div>

            {/* Approve inline form */}
            {isApproving && (
              <ApproveForm
                request={req}
                onConfirm={async () => { await refresh(); setApproveId(null); }}
                onCancel={() => setApproveId(null)}
              />
            )}

            {/* Reject inline form */}
            {isRejecting && (
              <RejectForm
                requestId={req.id}
                onConfirm={async () => { await refresh(); setRejectId(null); }}
                onCancel={() => setRejectId(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Approve Form ─────────────────────────────────────────────────

function ApproveForm({
  request,
  onConfirm,
  onCancel,
}: {
  request: CatalogRequest;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState(request.ingredientCategory);
  const [baseUnit, setBaseUnit] = useState(request.baseUnit);
  const [itemType, setItemType] = useState<ItemTypeKey>((request.itemType as ItemTypeKey) || "KITCHEN_INGREDIENT");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-3 p-3 rounded-lg bg-[#0A0A0A] border border-emerald-500/20 animate-[fadeIn_150ms_ease-out]">
      <p className="text-[10px] text-emerald-400 uppercase tracking-wider font-semibold mb-2">
        Confirm Approval
      </p>
      <div className="space-y-2">
        {/* Item type selector */}
        <div>
          <p className="text-[10px] text-[#666] uppercase tracking-wider mb-1">Item Type</p>
          <div className="flex gap-2">
            {ITEM_TYPE_KEYS.map((tk) => {
              const its = ITEM_TYPES[tk];
              return (
                <button key={tk} type="button"
                  onClick={() => setItemType(tk)}
                  className={`flex-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-all ${
                    itemType === tk
                      ? `${its.bgClass} ${its.textClass} ${its.borderClass}`
                      : "bg-[#111] text-[#666] border-[#2A2A2A] hover:border-[#3A3A3A]"
                  }`}
                >
                  {its.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] text-[#666] uppercase tracking-wider mb-1">Category</p>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg bg-[#111] border border-[#2A2A2A] text-xs text-white focus:outline-none">
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <p className="text-[10px] text-[#666] uppercase tracking-wider mb-1">Base Unit</p>
            <select value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg bg-[#111] border border-[#2A2A2A] text-xs text-white focus:outline-none">
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel}
            className="px-3 py-1 rounded-lg text-xs text-[#999] hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                const res = await fetch(`${API}/catalog-requests/${request.id}/approve`, {
                  ...jsonOpts, method: "POST",
                  body: JSON.stringify({ ingredientCategory: category, baseUnit, itemType }),
                });
                if (!res.ok) {
                  const err = await res.json();
                  throw new Error(err.error || "Failed to approve");
                }
                await onConfirm();
              } catch (err: any) {
                setError(err.message);
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/30 disabled:opacity-50 transition-all"
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Confirm Approval
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reject Form ──────────────────────────────────────────────────

function RejectForm({
  requestId,
  onConfirm,
  onCancel,
}: {
  requestId: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-3 p-3 rounded-lg bg-[#0A0A0A] border border-red-500/20 animate-[fadeIn_150ms_ease-out]">
      <p className="text-[10px] text-red-400 uppercase tracking-wider font-semibold mb-2">
        Rejection Reason
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Provide a reason for rejecting this request..."
        rows={2}
        autoFocus
        className="w-full px-3 py-2 rounded-lg bg-[#111] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-red-500/30 resize-none"
      />

      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}

      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onCancel}
          className="px-3 py-1 rounded-lg text-xs text-[#999] hover:text-white transition-colors">
          Cancel
        </button>
        <button
          onClick={async () => {
            if (!reason.trim()) {
              setError("A reason is required");
              return;
            }
            setSaving(true);
            setError(null);
            try {
              const res = await fetch(`${API}/catalog-requests/${requestId}/reject`, {
                ...jsonOpts, method: "POST",
                body: JSON.stringify({ reason: reason.trim() }),
              });
              if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Failed to reject");
              }
              await onConfirm();
            } catch (err: any) {
              setError(err.message);
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving || !reason.trim()}
          className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-semibold hover:bg-red-500/30 disabled:opacity-50 transition-all"
        >
          {saving ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
          Reject
        </button>
      </div>
    </div>
  );
}

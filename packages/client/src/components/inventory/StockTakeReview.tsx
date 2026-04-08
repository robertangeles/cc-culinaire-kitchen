/**
 * @module components/inventory/StockTakeReview
 *
 * HQ review panel for stock take sessions. Shows full context:
 * - Which location, who opened, when
 * - Each submitted category with all line items (ingredient, qty, variance)
 * - Expand/collapse per category
 * - Approve all or flag specific categories with reason
 */

import { useState, useCallback } from "react";
import {
  useStockTake,
  type StockTakeSession,
  type StockTakeCategory,
  type StockTakeLine,
} from "../../hooks/useInventory.js";
import { useLocation } from "../../context/LocationContext.js";
import {
  ShieldCheck, CheckCircle2, Flag, ChevronDown, ChevronRight,
  MapPin, User, Clock, AlertTriangle, TrendingDown, TrendingUp,
  Loader2, Package,
} from "lucide-react";

interface Props {
  session: StockTakeSession;
  onActionComplete: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  proteins: "Proteins", produce: "Produce", dairy: "Dairy",
  dry_goods: "Dry Goods", beverages: "Beverages", spirits: "Spirits",
  frozen: "Frozen", bakery: "Bakery", condiments: "Condiments", other: "Other",
};

export function StockTakeReview({ session, onActionComplete }: Props) {
  const { approveSession, flagSession, getLines } = useStockTake();
  const { locations } = useLocation();

  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [catLines, setCatLines] = useState<Record<string, StockTakeLine[]>>({});
  const [loadingCat, setLoadingCat] = useState<string | null>(null);
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [flaggedCats, setFlaggedCats] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const location = locations.find((l) => l.storeLocationId === session.storeLocationId);
  const submittedCats = session.categories.filter(
    (c) => c.categoryStatus === "SUBMITTED" || c.categoryStatus === "APPROVED",
  );
  const notStartedCats = session.categories.filter((c) => c.categoryStatus === "NOT_STARTED");

  // Load lines for a category
  const loadCatLines = useCallback(async (catName: string) => {
    if (catLines[catName]) return; // already loaded
    setLoadingCat(catName);
    try {
      const lines = await getLines(session.sessionId, catName);
      setCatLines((prev) => ({ ...prev, [catName]: lines }));
    } finally {
      setLoadingCat(null);
    }
  }, [session.sessionId, getLines, catLines]);

  const toggleCategory = (catName: string) => {
    const next = new Set(expandedCats);
    if (next.has(catName)) {
      next.delete(catName);
    } else {
      next.add(catName);
      loadCatLines(catName);
    }
    setExpandedCats(next);
  };

  // Categories start collapsed — click to expand (no scrolling)

  return (
    <div className="space-y-6 animate-[fadeInUp_200ms_ease-out]">
      {/* Session context header */}
      <div className="p-5 rounded-xl bg-[#161616] border border-[#2A2A2A]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#D4A574]/10 flex items-center justify-center">
            <ShieldCheck className="size-5 text-[#D4A574]" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Stock Take Review</h3>
            <p className="text-xs text-[#999]">Review counts before approving</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <MapPin className="size-4 text-[#D4A574]" />
            <div>
              <p className="text-xs text-[#666]">Location</p>
              <p className="text-white font-medium">{location?.locationName ?? "Unknown"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <User className="size-4 text-[#D4A574]" />
            <div>
              <p className="text-xs text-[#666]">Opened by</p>
              <p className="text-white font-medium">{session.openedByUserName ?? `User #${session.openedByUserId}`}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-[#D4A574]" />
            <div>
              <p className="text-xs text-[#666]">Submitted</p>
              <p className="text-white font-medium">
                {session.submittedDttm
                  ? new Date(session.submittedDttm).toLocaleString()
                  : new Date(session.openedDttm).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        {/* Summary stats */}
        <div className="flex gap-4 mt-4 pt-4 border-t border-[#2A2A2A]">
          <span className="text-xs text-[#999]">
            <span className="text-white font-medium">{submittedCats.length}</span> categor{submittedCats.length === 1 ? "y" : "ies"} counted
          </span>
          {notStartedCats.length > 0 && (
            <span className="text-xs text-[#666]">
              {notStartedCats.length} skipped
            </span>
          )}
          <span className="text-xs text-[#999]">
            <span className="text-white font-medium">
              {submittedCats.reduce((sum, c) => sum + (c.lineCount ?? 0), 0)}
            </span> total items
          </span>
        </div>
      </div>

      {/* Category detail cards */}
      {submittedCats.map((cat) => (
        <CategoryReviewCard
          key={cat.categoryId}
          category={cat}
          lines={catLines[cat.categoryName] ?? []}
          isExpanded={expandedCats.has(cat.categoryName)}
          isLoading={loadingCat === cat.categoryName}
          onToggle={() => toggleCategory(cat.categoryName)}
        />
      ))}

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <button
          onClick={async () => {
            try {
              setIsSubmitting(true);
              setError(null);
              await approveSession(session.sessionId);
              onActionComplete();
            } catch (err: any) {
              setError(err.message);
            } finally {
              setIsSubmitting(false);
            }
          }}
          disabled={isSubmitting}
          className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-semibold text-sm hover:shadow-[0_0_16px_rgba(52,211,153,0.3)] transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          Approve All Categories
        </button>
        <button
          onClick={() => setFlagModalOpen(true)}
          className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-semibold text-sm hover:bg-red-500/20 transition-all active:scale-[0.98]"
        >
          <Flag className="size-4" />
          Flag for Recount
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Flag modal */}
      {flagModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
          onClick={() => setFlagModalOpen(false)}
        >
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#161616] border border-[#2A2A2A] shadow-2xl animate-[scaleIn_200ms_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Flag className="size-5 text-red-400" />
              Flag Categories for Recount
            </h4>
            <p className="text-xs text-[#999] mb-4">Select which categories need recounting.</p>
            <div className="space-y-2 mb-4">
              {submittedCats.map((cat) => (
                <label key={cat.categoryId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#1E1E1E] cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={flaggedCats.has(cat.categoryName)}
                    onChange={(e) => {
                      const next = new Set(flaggedCats);
                      if (e.target.checked) next.add(cat.categoryName);
                      else next.delete(cat.categoryName);
                      setFlaggedCats(next);
                    }}
                    className="rounded border-[#3A3A3A] bg-[#0A0A0A] text-[#D4A574] focus:ring-[#D4A574]/50"
                  />
                  <span className="text-sm text-white">
                    {CATEGORY_LABELS[cat.categoryName] || cat.categoryName}
                  </span>
                </label>
              ))}
            </div>
            <textarea
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              placeholder="Reason for flagging (required)..."
              rows={3}
              className="w-full px-3 py-2 rounded-xl bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-red-500/50 resize-none mb-4"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setFlagModalOpen(false); setFlaggedCats(new Set()); setFlagReason(""); }}
                className="px-4 py-2 rounded-xl text-sm text-[#999] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (flaggedCats.size === 0 || !flagReason.trim()) return;
                  try {
                    setIsSubmitting(true);
                    await flagSession(session.sessionId, [...flaggedCats], flagReason.trim());
                    setFlagModalOpen(false);
                    setFlaggedCats(new Set());
                    setFlagReason("");
                    onActionComplete();
                  } catch (err: any) {
                    setError(err.message);
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
                disabled={flaggedCats.size === 0 || !flagReason.trim() || isSubmitting}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-500 text-white text-sm font-medium disabled:opacity-50 active:scale-[0.98] transition-all"
              >
                {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Flag className="size-4" />}
                Flag {flaggedCats.size}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryReviewCard({
  category, lines, isExpanded, isLoading, onToggle,
}: {
  category: StockTakeCategory;
  lines: StockTakeLine[];
  isExpanded: boolean;
  isLoading: boolean;
  onToggle: () => void;
}) {
  const hasVarianceIssues = lines.some(
    (l) => l.variancePct && Math.abs(Number(l.variancePct)) > 10,
  );

  return (
    <div className={`rounded-xl border overflow-hidden transition-all ${
      hasVarianceIssues
        ? "bg-amber-500/5 border-amber-500/20"
        : "bg-[#161616] border-[#2A2A2A]"
    }`}>
      {/* Header — clickable to expand */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-[#1E1E1E]/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded
            ? <ChevronDown className="size-4 text-[#999]" />
            : <ChevronRight className="size-4 text-[#999]" />
          }
          <h4 className="text-sm font-medium text-white">
            {CATEGORY_LABELS[category.categoryName] || category.categoryName}
          </h4>
          <span className="text-xs text-[#666]">{category.lineCount ?? lines.length} items</span>
          {hasVarianceIssues && (
            <span className="flex items-center gap-1 text-xs text-amber-400">
              <AlertTriangle className="size-3" />
              Variance
            </span>
          )}
        </div>
        {category.claimedByUserId && (
          <span className="text-xs text-[#666] flex items-center gap-1">
            <User className="size-3" />
            {category.claimedByUserName ?? `#${category.claimedByUserId}`}
          </span>
        )}
      </button>

      {/* Expanded line items */}
      {isExpanded && (
        <div className="border-t border-[#2A2A2A]">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 text-[#D4A574] animate-spin" />
            </div>
          ) : lines.length === 0 ? (
            <p className="text-xs text-[#666] text-center py-6">No items counted</p>
          ) : (
            <div className="divide-y divide-[#2A2A2A]/50">
              {/* Column headers */}
              <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] text-[#666] uppercase tracking-wider">
                <div className="col-span-4">Ingredient</div>
                <div className="col-span-2 text-right">Counted</div>
                <div className="col-span-2 text-right">Expected</div>
                <div className="col-span-2 text-right">Variance</div>
                <div className="col-span-2 text-right">By</div>
              </div>
              {lines.map((line) => (
                <LineItemRow key={line.lineId} line={line} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LineItemRow({ line }: { line: StockTakeLine }) {
  const variance = line.varianceQty ? Number(line.varianceQty) : null;
  const variancePct = line.variancePct ? Number(line.variancePct) : null;
  const isHigh = variancePct !== null && Math.abs(variancePct) > 10;

  return (
    <div className={`px-4 py-2.5 text-sm ${
      isHigh ? "bg-amber-500/5" : "hover:bg-[#1E1E1E]/30"
    } transition-colors`}>
      {/* Desktop: grid layout */}
      <div className="hidden sm:grid grid-cols-12 gap-2">
        <div className="col-span-4 text-white truncate">
          {line.ingredientName ?? line.ingredientId.slice(0, 8)}
          <span className="text-[10px] text-[#666] ml-1">{line.countedUnit}</span>
        </div>
        <div className="col-span-2 text-right text-white font-medium tabular-nums">
          {Number(line.countedQty).toFixed(1)}
        </div>
        <div className="col-span-2 text-right text-[#999] tabular-nums">
          {line.expectedQty ? Number(line.expectedQty).toFixed(1) : "—"}
        </div>
        <div className={`col-span-2 text-right tabular-nums flex items-center justify-end gap-1 ${
          variance === null ? "text-[#666]"
            : variance > 0 ? "text-emerald-400"
            : variance < 0 ? "text-red-400"
            : "text-[#999]"
        }`}>
          {variance !== null ? (
            <>
              {variance > 0 ? <TrendingUp className="size-3" /> : variance < 0 ? <TrendingDown className="size-3" /> : null}
              {variance > 0 ? "+" : ""}{variance.toFixed(1)}
              {variancePct !== null && (
                <span className="text-[10px]">({variancePct.toFixed(0)}%)</span>
              )}
            </>
          ) : "—"}
        </div>
        <div className="col-span-2 text-right text-[10px] text-[#666]">
          {line.countedByUserName ?? `#${line.countedByUserId}`}
          <br />
          {new Date(line.countedDttm).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      {/* Mobile: stacked layout */}
      <div className="sm:hidden flex flex-col gap-1">
        <div className="flex justify-between items-baseline">
          <span className="text-white font-medium truncate">
            {line.ingredientName ?? line.ingredientId.slice(0, 8)}
          </span>
          <span className="text-white font-medium tabular-nums ml-2 shrink-0">
            {Number(line.countedQty).toFixed(1)} {line.countedUnit}
          </span>
        </div>
        <div className="flex justify-between text-[10px] text-[#666]">
          <span>{line.countedByUserName ?? `#${line.countedByUserId}`} · {new Date(line.countedDttm).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          {variance !== null && (
            <span className={variance > 0 ? "text-emerald-400" : variance < 0 ? "text-red-400" : "text-[#999]"}>
              {variance > 0 ? "+" : ""}{variance.toFixed(1)} ({variancePct?.toFixed(0)}%)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

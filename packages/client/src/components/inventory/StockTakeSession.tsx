/**
 * @module components/inventory/StockTakeSession
 *
 * Stock take session manager — shows category cards, handles claiming,
 * counting, and submitting. Integrates CategoryCounter for the
 * mobile-optimized counting interface.
 */

import { useState } from "react";
import { useStockTake, type StockTakeCategory } from "../../hooks/useInventory.js";
import { useLocation } from "../../context/LocationContext.js";
import { CategoryCounter } from "./CategoryCounter.js";
import { StockTakeReview } from "./StockTakeReview.js";
import {
  ClipboardCheck, Play, CheckCircle2, AlertTriangle,
  Clock, Loader2, ChevronRight, Lock, ShieldCheck, Flag,
} from "lucide-react";

const ALL_CATEGORIES = [
  { key: "proteins", label: "Proteins" },
  { key: "produce", label: "Produce" },
  { key: "dairy", label: "Dairy" },
  { key: "dry_goods", label: "Dry Goods" },
  { key: "beverages", label: "Beverages" },
  { key: "spirits", label: "Spirits" },
  { key: "frozen", label: "Frozen" },
  { key: "bakery", label: "Bakery" },
  { key: "condiments", label: "Condiments" },
  { key: "other", label: "Other" },
];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  ALL_CATEGORIES.map((c) => [c.key, c.label]),
);

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; icon: typeof CheckCircle2 }> = {
  NOT_STARTED: { color: "text-[#666]", bg: "bg-[#1E1E1E]", border: "border-[#2A2A2A]", icon: Clock },
  IN_PROGRESS: { color: "text-[#D4A574]", bg: "bg-[#D4A574]/10", border: "border-[#D4A574]/20", icon: Play },
  SUBMITTED: { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", icon: CheckCircle2 },
  APPROVED: { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", icon: CheckCircle2 },
  FLAGGED: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", icon: AlertTriangle },
};

export function StockTakeSession() {
  const {
    session, isLoading, openSession, claimCategory,
    submitCategory, getDetail, approveSession, flagSession, submitForReview,
  } = useStockTake();
  const { isOrgAdmin } = useLocation();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [flaggedCats, setFlaggedCats] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [selectedNewCats, setSelectedNewCats] = useState<Set<string>>(new Set(ALL_CATEGORIES.map(c => c.key)));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 text-[#D4A574] animate-spin" />
      </div>
    );
  }

  // No active session — show start button
  if (!session) {
    return (
      <div className="text-center py-16 animate-[fadeInUp_200ms_ease-out]">
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[#D4A574]/20 to-[#C4956A]/10 flex items-center justify-center shadow-[0_0_20px_rgba(212,165,116,0.1)]">
          <ClipboardCheck className="size-10 text-[#D4A574]" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">Ready for Stock Take</h3>
        <p className="text-sm text-[#999] max-w-md mx-auto mb-8">
          Select which categories to count — cycle count (weekly) or full inventory (monthly).
        </p>
        {error && (
          <p className="text-sm text-red-400 mb-4">{error}</p>
        )}

        {!showCategoryPicker ? (
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => setShowCategoryPicker(true)}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] font-semibold text-sm hover:shadow-[0_0_16px_rgba(212,165,116,0.3)] transition-all active:scale-[0.98]"
            >
              Cycle Count
            </button>
            <button
              onClick={async () => {
                try {
                  setError(null);
                  await openSession(); // all categories
                } catch (err: any) {
                  setError(err.message);
                }
              }}
              className="px-6 py-3 rounded-xl bg-[#1E1E1E] border border-[#2A2A2A] text-white font-semibold text-sm hover:bg-[#2A2A2A] transition-all active:scale-[0.98]"
            >
              Full Inventory
            </button>
          </div>
        ) : (
          <div className="max-w-sm mx-auto animate-[scaleIn_200ms_ease-out]">
            <p className="text-xs text-[#999] mb-3 text-left">Select categories to count:</p>
            <div className="space-y-1.5 mb-4">
              {ALL_CATEGORIES.map((cat) => (
                <label key={cat.key} className="flex items-center gap-3 p-2.5 rounded-lg bg-[#161616] border border-[#2A2A2A] hover:border-[#3A3A3A] cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedNewCats.has(cat.key)}
                    onChange={(e) => {
                      const next = new Set(selectedNewCats);
                      if (e.target.checked) next.add(cat.key);
                      else next.delete(cat.key);
                      setSelectedNewCats(next);
                    }}
                    className="rounded border-[#3A3A3A] bg-[#0A0A0A] text-[#D4A574] focus:ring-[#D4A574]/50"
                  />
                  <span className="text-sm text-white">{cat.label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCategoryPicker(false)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm text-[#999] hover:text-white border border-[#2A2A2A] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (selectedNewCats.size === 0) return;
                  try {
                    setError(null);
                    await openSession([...selectedNewCats]);
                    setShowCategoryPicker(false);
                  } catch (err: any) {
                    setError(err.message);
                  }
                }}
                disabled={selectedNewCats.size === 0}
                className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] font-semibold text-sm disabled:opacity-50 active:scale-[0.98] transition-all"
              >
                Start ({selectedNewCats.size})
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Active category — show counter
  if (activeCategory && session) {
    const cat = session.categories.find((c) => c.categoryName === activeCategory);
    return (
      <CategoryCounter
        sessionId={session.sessionId}
        category={cat!}
        onBack={() => {
          setActiveCategory(null);
          getDetail(session.sessionId);
        }}
      />
    );
  }

  // Session active — show category grid
  return (
    <div className="space-y-6 animate-[fadeInUp_200ms_ease-out]">
      {/* Session header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Active Stock Take</h3>
          <p className="text-xs text-[#999] mt-1">
            Status: <span className="text-[#D4A574]">{session.sessionStatus}</span>
            {" · "}
            Opened {new Date(session.openedDttm).toLocaleString()}
          </p>
        </div>
        <SessionProgress categories={session.categories} />
      </div>

      {/* Flag reason banner */}
      {session.flagReason && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
          <AlertTriangle className="size-5 text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-400">HQ flagged this session</p>
            <p className="text-xs text-[#999] mt-1">{session.flagReason}</p>
          </div>
        </div>
      )}

      {/* HQ Review — full detail view when session is PENDING_REVIEW */}
      {isOrgAdmin && session.sessionStatus === "PENDING_REVIEW" && (
        <StockTakeReview
          session={session}
          onActionComplete={() => getDetail(session.sessionId)}
        />
      )}

      {/* Category cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {session.categories.map((cat) => (
          <CategoryCard
            key={cat.categoryId}
            category={cat}
            onSelect={async () => {
              try {
                setError(null);
                if (cat.categoryStatus === "NOT_STARTED" || cat.categoryStatus === "FLAGGED") {
                  await claimCategory(session.sessionId, cat.categoryName);
                }
                setActiveCategory(cat.categoryName);
              } catch (err: any) {
                setError(err.message);
              }
            }}
            onSubmit={async () => {
              try {
                setError(null);
                await submitCategory(session.sessionId, cat.categoryName);
              } catch (err: any) {
                setError(err.message);
              }
            }}
          />
        ))}
      </div>

      {/* Submit for Review button — visible when at least one category is submitted and session is OPEN */}
      {session.sessionStatus === "OPEN" &&
        session.categories.some((c) => c.categoryStatus === "SUBMITTED") &&
        !session.categories.some((c) => c.categoryStatus === "IN_PROGRESS") && (
        <div className="flex justify-center pt-2">
          <button
            onClick={async () => {
              try {
                setIsSubmitting(true);
                setError(null);
                await submitForReview(session.sessionId);
              } catch (err: any) {
                setError(err.message);
              } finally {
                setIsSubmitting(false);
              }
            }}
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] font-semibold text-sm hover:shadow-[0_0_16px_rgba(212,165,116,0.3)] transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Submit for Review
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 text-center">{error}</p>
      )}
    </div>
  );
}

function CategoryCard({
  category, onSelect, onSubmit,
}: {
  category: StockTakeCategory;
  onSelect: () => void;
  onSubmit: () => void;
}) {
  const config = STATUS_CONFIG[category.categoryStatus] || STATUS_CONFIG.NOT_STARTED;
  const Icon = config.icon;
  const canCount = ["NOT_STARTED", "IN_PROGRESS", "FLAGGED"].includes(category.categoryStatus);
  const canSubmit = category.categoryStatus === "IN_PROGRESS";
  const isLocked = ["SUBMITTED", "APPROVED"].includes(category.categoryStatus);

  return (
    <div className={`p-4 rounded-xl border ${config.bg} ${config.border} transition-all ${
      canCount ? "hover:-translate-y-0.5 hover:shadow-lg cursor-pointer" : ""
    }`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={`size-4 ${config.color}`} />
          <h4 className="text-sm font-medium text-white">
            {CATEGORY_LABELS[category.categoryName] || category.categoryName}
          </h4>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${config.bg} ${config.color} border ${config.border}`}>
          {category.categoryStatus.replace("_", " ")}
        </span>
      </div>

      {category.lineCount !== undefined && (
        <p className="text-xs text-[#999] mb-3">{category.lineCount} items counted</p>
      )}

      {category.flagReason && (
        <p className="text-xs text-red-400 mb-3 italic">"{category.flagReason}"</p>
      )}

      <div className="flex gap-2">
        {canCount && (
          <button
            onClick={onSelect}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#D4A574]/10 text-[#D4A574] text-sm font-medium hover:bg-[#D4A574]/20 transition-colors"
          >
            {category.categoryStatus === "NOT_STARTED" ? "Start Counting" : "Continue"}
            <ChevronRight className="size-3.5" />
          </button>
        )}
        {canSubmit && (
          <button
            onClick={(e) => { e.stopPropagation(); onSubmit(); }}
            className="px-3 py-2 rounded-lg bg-blue-500/10 text-blue-400 text-sm font-medium hover:bg-blue-500/20 transition-colors"
          >
            Submit
          </button>
        )}
        {isLocked && (
          <div className="flex items-center gap-1.5 text-xs text-[#666]">
            <Lock className="size-3" />
            {category.categoryStatus === "APPROVED" ? "Approved" : "Pending review"}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionProgress({ categories }: { categories: StockTakeCategory[] }) {
  const total = categories.length;
  const done = categories.filter(
    (c) => c.categoryStatus === "SUBMITTED" || c.categoryStatus === "APPROVED",
  ).length;
  const pct = total > 0 ? (done / total) * 100 : 0;

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[#999]">{done}/{total}</span>
      <div className="w-24 h-2 rounded-full bg-[#2A2A2A] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#D4A574] to-emerald-400 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

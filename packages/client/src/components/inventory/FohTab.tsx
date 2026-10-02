/**
 * @module components/inventory/FohTab
 *
 * Front-of-House stock loop for FOH consumables at the selected location:
 * see the shelf (BOH + FOH), stock the fridge (BOH->FOH), reconcile a count,
 * log front-shelf waste, record sales (which deduct FOH), and view the
 * revenue/COGS/margin report.
 *
 * sales:record gates the operational actions; sales:read gates the report.
 * The server routes are the security boundary — this only hides what the user
 * can't use.
 */

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { Plus, X, RefreshCw, TrendingUp, AlertTriangle, PackagePlus, ClipboardCheck, Trash2, ShoppingCart, Loader2 } from "lucide-react";
import {
  useFohStock,
  restockFoh,
  countFoh,
  wasteFoh,
  recordSales,
  updateFohPar,
  getRestockSuggestions,
  getSalesReport,
  type FohStockItem,
  type SaleLine,
  type RecordSalesResult,
  type FohSalesReport,
} from "../../hooks/useFoh.js";
import { useHasPermission } from "../../hooks/useHasPermission.js";

type ActionKind = "restock" | "count" | "waste";

const ACTION_META: Record<ActionKind, { title: string; verb: string; hint: (i: FohStockItem) => string }> = {
  restock: { title: "Stock the fridge", verb: "Move to FOH", hint: (i) => `Moves stock from back-of-house (${i.bohQty}) to the front shelf.` },
  count: { title: "Count FOH shelf", verb: "Set FOH qty", hint: (i) => `Reconcile the shelf. Current system qty: ${i.fohQty}.` },
  waste: { title: "Log FOH waste", verb: "Log waste", hint: () => "Breakage, spoilage — deducts the FOH shelf." },
};

export function FohTab({ locationId }: { locationId: string | null }) {
  const hasPermission = useHasPermission();
  const canRecord = hasPermission("sales:record");
  const canRead = hasPermission("sales:read");
  const { items, isLoading, refresh } = useFohStock(locationId);

  const [action, setAction] = useState<{ kind: ActionKind; item: FohStockItem; suggested?: number } | null>(null);
  const [saleOpen, setSaleOpen] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, number>>({});

  // Load restock-to-par suggestions to pre-fill the restock action.
  useEffect(() => {
    if (!locationId || !canRecord) return;
    getRestockSuggestions(locationId)
      .then((s) => setSuggestions(Object.fromEntries(s.map((x) => [x.ingredientId, x.suggestedQty]))))
      .catch(() => setSuggestions({}));
  }, [locationId, canRecord, items]);

  if (!locationId) {
    return <p className="text-sm text-[#999] text-center py-12">Select a location to manage its front-of-house shelf.</p>;
  }

  const lowCount = items.filter((i) => i.lowFoh).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-white">Front of House</h2>
          <p className="text-xs text-[#999]">
            Sellable shelf stock. A recorded sale deducts the FOH quantity.
            {lowCount > 0 && (
              <span className="text-amber-400"> · {lowCount} item{lowCount > 1 ? "s" : ""} below par</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canRead && (
            <button
              onClick={() => setShowReport((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-surface-2/50 text-[#ccc] hover:text-white hover:border-white/20 transition-colors"
            >
              <TrendingUp className="size-3.5" /> {showReport ? "Hide report" : "Sales report"}
            </button>
          )}
          {canRecord && (
            <button
              onClick={() => setSaleOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-gradient-to-r from-accent to-amber-600 text-black font-medium shadow-[0_0_12px_rgba(255,214,10,0.15)] hover:-translate-y-0.5 transition-transform"
            >
              <ShoppingCart className="size-3.5" /> Record sale
            </button>
          )}
        </div>
      </div>

      {showReport && canRead && <SalesReportPanel locationId={locationId} />}

      {/* Item list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-[#666]" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <PackagePlus className="size-8 mx-auto text-sky-400 mb-3" />
          <p className="text-sm text-white font-medium mb-1">No FOH consumables active here</p>
          <p className="text-xs text-[#999]">Activate FOH consumables for this location in the Catalog.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/5 bg-surface-2/40 backdrop-blur-sm overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] text-[#666] uppercase tracking-wider border-b border-white/5">
            <div className="col-span-4">Item</div>
            <div className="col-span-1 text-right">BOH</div>
            <div className="col-span-1 text-right">FOH</div>
            <div className="col-span-2 text-right">FOH par</div>
            <div className="col-span-4 text-right">Actions</div>
          </div>
          {items.map((item) => (
            <FohRow
              key={item.ingredientId}
              item={item}
              locationId={locationId}
              canRecord={canRecord}
              onPar={refresh}
              onAction={(kind) => setAction({ kind, item, suggested: suggestions[item.ingredientId] })}
            />
          ))}
        </div>
      )}

      {action && (
        <QtyActionModal
          action={action}
          locationId={locationId}
          onClose={() => setAction(null)}
          onDone={() => { setAction(null); refresh(); }}
        />
      )}
      {saleOpen && (
        <RecordSaleModal
          items={items}
          locationId={locationId}
          onClose={() => setSaleOpen(false)}
          onDone={() => { setSaleOpen(false); refresh(); }}
        />
      )}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────

function FohRow({
  item, locationId, canRecord, onPar, onAction,
}: {
  item: FohStockItem;
  locationId: string;
  canRecord: boolean;
  onPar: () => void;
  onAction: (kind: ActionKind) => void;
}) {
  const [editingPar, setEditingPar] = useState(false);
  const [parInput, setParInput] = useState(item.fohParLevel != null ? String(item.fohParLevel) : "");
  const [saving, setSaving] = useState(false);

  async function savePar() {
    setSaving(true);
    try {
      await updateFohPar(locationId, item.ingredientId, parInput.trim() === "" ? null : parInput.trim());
      setEditingPar(false);
      onPar();
    } catch { /* surfaced elsewhere; keep the field open */ } finally { setSaving(false); }
  }

  return (
    <div className="grid grid-cols-12 gap-2 px-4 py-2 items-center text-sm border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
      <div className="col-span-4 text-white truncate">
        {item.ingredientName}
        {item.lowFoh && <AlertTriangle className="inline size-3 text-amber-400 ml-1.5 -mt-0.5" aria-label="below FOH par" />}
      </div>
      <div className="col-span-1 text-right font-mono tabular-nums text-[#999]">{item.bohQty.toFixed(1)}</div>
      <div className={`col-span-1 text-right font-mono tabular-nums ${item.lowFoh ? "text-amber-400" : item.fohQty < 0 ? "text-red-400" : "text-sky-400"}`}>
        {item.fohQty.toFixed(1)}
      </div>
      <div className="col-span-2 text-right font-mono tabular-nums">
        {editingPar && canRecord ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={parInput}
              onChange={(e) => setParInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && savePar()}
              className="w-14 bg-black/40 border border-white/10 rounded px-1 py-0.5 text-right text-white text-xs"
            />
            <button onClick={savePar} disabled={saving} className="text-emerald-400 hover:text-emerald-300 text-xs">✓</button>
          </span>
        ) : (
          <button
            onClick={() => canRecord && setEditingPar(true)}
            className={`text-[#888] ${canRecord ? "hover:text-white cursor-pointer" : "cursor-default"}`}
            title={canRecord ? "Set FOH par" : undefined}
          >
            {item.fohParLevel != null ? Number(item.fohParLevel).toFixed(0) : "—"}
          </button>
        )}
      </div>
      <div className="col-span-4 flex items-center justify-end gap-1">
        {canRecord ? (
          <>
            <RowBtn onClick={() => onAction("restock")} icon={<PackagePlus className="size-3.5" />} label="Restock" />
            <RowBtn onClick={() => onAction("count")} icon={<ClipboardCheck className="size-3.5" />} label="Count" />
            <RowBtn onClick={() => onAction("waste")} icon={<Trash2 className="size-3.5" />} label="Waste" />
          </>
        ) : (
          <span className="text-[10px] text-[#666]">view only</span>
        )}
      </div>
    </div>
  );
}

function RowBtn({ onClick, icon, label }: { onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-white/10 text-[#ccc] hover:text-white hover:border-white/20 hover:bg-white/5 transition-colors"
    >
      {icon} {label}
    </button>
  );
}

// ─── Quantity action modal (restock / count / waste) ──────────────

function QtyActionModal({
  action, locationId, onClose, onDone,
}: {
  action: { kind: ActionKind; item: FohStockItem; suggested?: number };
  locationId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const meta = ACTION_META[action.kind];
  const initial = action.kind === "restock" && action.suggested ? String(action.suggested)
    : action.kind === "count" ? String(action.item.fohQty) : "";
  const [qty, setQty] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const n = Number(qty);
    if (isNaN(n) || (action.kind !== "count" && n <= 0) || (action.kind === "count" && n < 0)) {
      setError("Enter a valid quantity");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (action.kind === "restock") await restockFoh(locationId, action.item.ingredientId, n);
      else if (action.kind === "count") await countFoh(locationId, action.item.ingredientId, n);
      else await wasteFoh(locationId, action.item.ingredientId, n, action.item.baseUnit);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally { setBusy(false); }
  }

  return (
    <Modal onClose={onClose} title={meta.title}>
      <p className="text-sm text-white font-medium">{action.item.ingredientName}</p>
      <p className="text-xs text-[#999] mb-3">{meta.hint(action.item)}</p>
      <label className="block text-xs text-[#888] mb-1">
        {action.kind === "count" ? "Counted quantity" : "Quantity"} ({action.item.baseUnit})
      </label>
      <input
        autoFocus
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:border-sky-500/50 focus:shadow-[0_0_10px_rgba(14,165,233,0.15)] outline-none"
      />
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-white/10 text-[#ccc] hover:text-white">Cancel</button>
        <button
          onClick={submit}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-gradient-to-r from-sky-500 to-sky-600 text-white font-medium disabled:opacity-60"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />} {meta.verb}
        </button>
      </div>
    </Modal>
  );
}

// ─── Record sale modal (manual lines + CSV) ───────────────────────

function RecordSaleModal({
  items, locationId, onClose, onDone,
}: {
  items: FohStockItem[];
  locationId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [lines, setLines] = useState<Array<{ ingredientId: string; quantity: string; unitPrice: string }>>([
    { ingredientId: items[0]?.ingredientId ?? "", quantity: "1", unitPrice: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecordSalesResult | null>(null);

  function addLine() {
    setLines((ls) => [...ls, { ingredientId: items[0]?.ingredientId ?? "", quantity: "1", unitPrice: "" }]);
  }
  function setLine(i: number, patch: Partial<{ ingredientId: string; quantity: string; unitPrice: string }>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  }

  // CSV: "ingredient name or id, quantity, unit price" per row. Names are
  // matched case-insensitively against the FOH catalog.
  function importCsv(text: string) {
    const byName = new Map(items.map((i) => [i.ingredientName.trim().toLowerCase(), i.ingredientId]));
    const byId = new Set(items.map((i) => i.ingredientId));
    const parsed: Array<{ ingredientId: string; quantity: string; unitPrice: string }> = [];
    for (const raw of text.split(/\r?\n/)) {
      const row = raw.trim();
      if (!row) continue;
      const [col0, col1, col2] = row.split(",").map((c) => c.trim());
      if (!col0 || /^(item|ingredient|name)$/i.test(col0)) continue; // skip header
      const ingredientId = byId.has(col0) ? col0 : byName.get(col0.toLowerCase()) ?? col0;
      parsed.push({ ingredientId, quantity: col1 || "1", unitPrice: col2 || "" });
    }
    if (parsed.length) setLines(parsed);
  }

  async function submit(source: "MANUAL" | "CSV") {
    const payload: SaleLine[] = lines.map((l) => ({
      ingredientId: l.ingredientId,
      quantity: Number(l.quantity),
      unitPrice: l.unitPrice.trim() === "" ? null : Number(l.unitPrice),
    }));
    if (payload.length === 0) { setError("Add at least one line"); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await recordSales(locationId, payload, source);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record sale");
    } finally { setBusy(false); }
  }

  if (result) {
    return (
      <Modal onClose={onDone} title="Sale recorded">
        <p className="text-sm text-white mb-2">
          {result.recorded.length} line{result.recorded.length !== 1 ? "s" : ""} recorded, FOH stock deducted.
        </p>
        {result.oversoldCount > 0 && (
          <p className="text-xs text-amber-400 flex items-center gap-1.5 mb-2">
            <AlertTriangle className="size-3.5" /> {result.oversoldCount} line{result.oversoldCount > 1 ? "s" : ""} oversold (FOH went negative) — reconcile with a count.
          </p>
        )}
        {result.rejected.length > 0 && (
          <div className="text-xs text-red-400 mb-2">
            {result.rejected.length} line{result.rejected.length > 1 ? "s" : ""} skipped:
            <ul className="list-disc ml-4 mt-1">
              {result.rejected.map((r, i) => <li key={i}>{r.reason}</li>)}
            </ul>
          </div>
        )}
        <div className="flex justify-end mt-4">
          <button onClick={onDone} className="px-3 py-1.5 text-xs rounded-lg bg-gradient-to-r from-accent to-amber-600 text-black font-medium">Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Record FOH sale" wide>
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={l.ingredientId}
              onChange={(e) => setLine(i, { ingredientId: e.target.value })}
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs outline-none focus:border-sky-500/50"
            >
              {items.map((it) => <option key={it.ingredientId} value={it.ingredientId}>{it.ingredientName}</option>)}
            </select>
            <input
              value={l.quantity}
              onChange={(e) => setLine(i, { quantity: e.target.value })}
              placeholder="Qty"
              className="w-16 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs text-right outline-none focus:border-sky-500/50"
            />
            <input
              value={l.unitPrice}
              onChange={(e) => setLine(i, { unitPrice: e.target.value })}
              placeholder="Price"
              className="w-20 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs text-right outline-none focus:border-sky-500/50"
            />
            <button onClick={() => removeLine(i)} className="text-[#666] hover:text-red-400"><X className="size-4" /></button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mt-3">
        <button onClick={addLine} className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300">
          <Plus className="size-3.5" /> Add line
        </button>
        <label className="text-xs text-[#888] hover:text-white cursor-pointer">
          Import CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) f.text().then(importCsv);
            }}
          />
        </label>
      </div>

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-white/10 text-[#ccc] hover:text-white">Cancel</button>
        <button
          onClick={() => submit("MANUAL")}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-gradient-to-r from-accent to-amber-600 text-black font-medium disabled:opacity-60"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />} Record sale
        </button>
      </div>
    </Modal>
  );
}

// ─── Sales report panel ───────────────────────────────────────────

function SalesReportPanel({ locationId }: { locationId: string }) {
  const [report, setReport] = useState<FohSalesReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    getSalesReport(locationId).then(setReport).catch(() => setReport(null)).finally(() => setLoading(false));
  }, [locationId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-6"><Loader2 className="size-4 animate-spin text-[#666]" /></div>;
  if (!report || report.items.length === 0) {
    return <div className="rounded-xl border border-white/5 bg-surface-2/40 p-4 text-xs text-[#999]">No FOH sales in the last 30 days.</div>;
  }

  const money = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div className="rounded-xl border border-white/5 bg-surface-2/40 backdrop-blur-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <span className="text-xs text-[#ccc] font-medium">FOH sales — last 30 days</span>
        <button onClick={load} className="text-[#666] hover:text-white"><RefreshCw className="size-3.5" /></button>
      </div>
      <div className="grid grid-cols-12 gap-2 px-4 py-1.5 text-[10px] text-[#666] uppercase tracking-wider">
        <div className="col-span-4">Item</div>
        <div className="col-span-2 text-right">Units</div>
        <div className="col-span-2 text-right">Revenue</div>
        <div className="col-span-2 text-right">COGS</div>
        <div className="col-span-2 text-right">Margin</div>
      </div>
      {report.items.map((it) => (
        <div key={it.ingredientId} className="grid grid-cols-12 gap-2 px-4 py-1.5 text-xs items-center border-t border-white/5">
          <div className="col-span-4 text-white truncate">
            {it.ingredientName}
            {it.oversoldLines > 0 && <span className="text-amber-400 ml-1" title={`${it.oversoldLines} oversold`}>⚠</span>}
          </div>
          <div className="col-span-2 text-right font-mono text-[#999]">{it.unitsSold}</div>
          <div className="col-span-2 text-right font-mono text-white">{money(it.revenue)}</div>
          <div className="col-span-2 text-right font-mono text-[#999]">{money(it.cogs)}</div>
          <div className={`col-span-2 text-right font-mono ${it.margin >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(it.margin)}</div>
        </div>
      ))}
      <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs items-center border-t border-white/10 bg-white/[0.02] font-medium">
        <div className="col-span-6 text-[#ccc]">Totals</div>
        <div className="col-span-2 text-right font-mono text-white">{money(report.totals.revenue)}</div>
        <div className="col-span-2 text-right font-mono text-[#999]">{money(report.totals.cogs)}</div>
        <div className={`col-span-2 text-right font-mono ${report.totals.margin >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(report.totals.margin)}</div>
      </div>
    </div>
  );
}

// ─── Shared modal shell ───────────────────────────────────────────

function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className={`w-full ${wide ? "max-w-lg" : "max-w-sm"} rounded-2xl border border-white/10 bg-surface-2/95 backdrop-blur-xl p-5 shadow-dark-lg`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * @module components/menu-intelligence/RecordSaleModal
 *
 * Record a menu-item sale (recipe → stock depletion), import a sales CSV
 * (two-phase preview → commit), and void a recent sale. The server is the
 * boundary; this is a thin operator surface. In-flight buttons lock (D13).
 */

import { useState, useEffect, useCallback } from "react";
import { X, ShoppingCart, Upload, RotateCcw, Loader2, AlertTriangle } from "lucide-react";
import type { MenuItem } from "../../hooks/useMenuItems.js";
import {
  recordSale,
  voidSale,
  listSales,
  previewSalesCsv,
  commitSalesCsv,
  listConsumables,
  recordConsumableSale,
  type SellableConsumable,
  type RecordSaleResult,
  type CsvPreview,
} from "../../hooks/useSales.js";

type Tab = "manual" | "csv" | "history";

export function RecordSaleModal({
  items, locationId, onClose, onDone,
}: {
  items: MenuItem[];
  locationId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<Tab>("manual");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#141414] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><ShoppingCart className="size-4 text-[#D4A574]" /> Record sale</h3>
          <button onClick={onClose} className="text-[#666] hover:text-white"><X className="size-4" /></button>
        </div>

        <div className="flex gap-1 p-1 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] w-fit mb-4">
          {(["manual", "csv", "history"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs rounded-md capitalize ${tab === t ? "bg-[#D4A574] text-black font-medium" : "text-[#ccc] hover:text-white"}`}>
              {t}
            </button>
          ))}
        </div>

        {tab === "manual" && <ManualTab items={items} locationId={locationId} onDone={onDone} />}
        {tab === "csv" && <CsvTab onDone={onDone} />}
        {tab === "history" && <HistoryTab locationId={locationId} onDone={onDone} />}
      </div>
    </div>
  );
}

function ManualTab({ items, locationId, onDone }: { items: MenuItem[]; locationId: string | null; onDone: () => void }) {
  // Selection value is namespaced: "menu:<id>" for a dish, "cons:<id>" for a
  // FOH consumable sold directly (auto 1:1 depletion — no recipe math).
  const [selection, setSelection] = useState(items[0] ? `menu:${items[0].menuItemId}` : "");
  const [consumables, setConsumables] = useState<SellableConsumable[]>([]);
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecordSaleResult | null>(null);

  useEffect(() => {
    listConsumables()
      .then((c) => {
        setConsumables(c);
        // Nothing selected yet (no menu items) → default to the first consumable.
        if (!selection && c.length > 0) setSelection(`cons:${c[0].ingredientId}`);
      })
      .catch(() => setConsumables([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    const n = Number(qty);
    const [kind, id] = selection.split(":");
    if (!id || !(n > 0)) { setError("Pick an item and a quantity > 0"); return; }
    setBusy(true); setError(null);
    try {
      const key = `manual-${id}-${Date.now()}`;
      const res = kind === "cons"
        ? await recordConsumableSale(id, n, locationId ?? undefined, key)
        : await recordSale(id, n, locationId ?? undefined, key);
      setResult(res);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record sale");
    } finally { setBusy(false); }
  }

  if (result) {
    return (
      <div className="text-sm text-white space-y-2">
        <p>Sale recorded — {result.depleted.length} ingredient{result.depleted.length !== 1 ? "s" : ""} depleted.</p>
        {result.oversold.length > 0 && (
          <p className="text-xs text-amber-400 flex items-center gap-1.5"><AlertTriangle className="size-3.5" /> Oversold: {result.oversold.join(", ")} — reconcile with a count.</p>
        )}
        {result.skipped.length > 0 && (
          <p className="text-xs text-[#999]">Skipped {result.skipped.length} line(s): {result.skipped.map((s) => s.ingredientName).join(", ")}</p>
        )}
        <ul className="text-xs text-[#ccc] list-disc ml-4">
          {result.depleted.map((d) => <li key={d.ingredientId}>{d.ingredientName}: −{d.baseQty} {d.baseUnit} (on hand {d.fohOnHand})</li>)}
        </ul>
        <div className="flex justify-end"><button onClick={() => setResult(null)} className="px-3 py-1.5 text-xs rounded-lg bg-[#D4A574] text-black font-medium">Record another</button></div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-[#666] mb-1">Item sold</label>
        <select value={selection} onChange={(e) => setSelection(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white">
          {items.length > 0 && (
            <optgroup label="Menu items">
              {items.map((it) => <option key={it.menuItemId} value={`menu:${it.menuItemId}`}>{it.name}</option>)}
            </optgroup>
          )}
          {consumables.length > 0 && (
            <optgroup label="FOH consumables (sold as-is)">
              {consumables.map((c) => <option key={c.ingredientId} value={`cons:${c.ingredientId}`}>{c.ingredientName}</option>)}
            </optgroup>
          )}
        </select>
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-[#666] mb-1">Quantity sold</label>
        <input value={qty} onChange={(e) => setQty(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white" />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex justify-end">
        <button onClick={submit} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[#D4A574] text-black font-medium disabled:opacity-60">
          {busy && <Loader2 className="size-3.5 animate-spin" />} Record sale
        </button>
      </div>
    </div>
  );
}

function CsvTab({ onDone }: { onDone: () => void }) {
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ succeeded: unknown[]; alreadyExists: unknown[]; failed: Array<{ rowIndex: number; reason: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true); setError(null);
    try { setPreview(await previewSalesCsv(file)); }
    catch (e) { setError(e instanceof Error ? e.message : "Preview failed"); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!preview) return;
    setBusy(true); setError(null);
    try { setReport(await commitSalesCsv(preview.matched)); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "Commit failed"); }
    finally { setBusy(false); }
  }

  if (report) {
    return (
      <div className="text-sm text-white space-y-1">
        <p>{report.succeeded.length} recorded, {report.alreadyExists.length} already imported, {report.failed.length} failed.</p>
        {report.failed.length > 0 && <ul className="text-xs text-red-400 list-disc ml-4">{report.failed.map((f, i) => <li key={i}>row {f.rowIndex}: {f.reason}</li>)}</ul>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[#999]">CSV rows: <code>menu item name, quantity[, soldAt]</code>. Preview matches names before anything depletes.</p>
      <label className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg border border-dashed border-white/15 text-[#ccc] hover:text-white cursor-pointer w-fit">
        <Upload className="size-3.5" /> Choose CSV
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </label>
      {preview && (
        <div className="text-xs text-[#ccc]">
          <p className="text-emerald-400">{preview.matched.length} matched</p>
          {preview.unmatched.length > 0 && (
            <div className="text-amber-400 mt-1">{preview.unmatched.length} unmatched:
              <ul className="list-disc ml-4">{preview.unmatched.map((u) => <li key={u.rowIndex}>{u.name} — {u.reason}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {preview && preview.matched.length > 0 && (
        <div className="flex justify-end">
          <button onClick={commit} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[#D4A574] text-black font-medium disabled:opacity-60">
            {busy && <Loader2 className="size-3.5 animate-spin" />} Import {preview.matched.length} sale(s)
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryTab({ locationId, onDone }: { locationId: string | null; onDone: () => void }) {
  const [sales, setSales] = useState<Array<{ saleId: string; menuItemName: string; qtySold: string; source: string; soldAt: string; voidedAt: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    if (!locationId) { setLoading(false); return; }
    setLoading(true);
    listSales(locationId).then(setSales).catch(() => setSales([])).finally(() => setLoading(false));
  }, [locationId]);
  useEffect(() => { load(); }, [load]);

  async function doVoid(saleId: string) {
    try { await voidSale(saleId); onDone(); load(); } catch { /* surfaced by reload */ }
  }

  if (!locationId) return <p className="text-xs text-[#999]">Select a location to see its sales.</p>;
  if (loading) return <div className="flex justify-center py-4"><Loader2 className="size-4 animate-spin text-[#666]" /></div>;
  if (sales.length === 0) return <p className="text-xs text-[#999]">No sales recorded here yet.</p>;

  return (
    <div className="space-y-1 max-h-72 overflow-y-auto">
      {sales.map((s) => (
        <div key={s.saleId} className="flex items-center justify-between text-xs px-2 py-1.5 rounded border border-white/5">
          <span className={s.voidedAt ? "text-[#666] line-through" : "text-white"}>{s.menuItemName} ×{Number(s.qtySold)}</span>
          <span className="text-[#666]">{new Date(s.soldAt).toLocaleDateString()}</span>
          {s.voidedAt ? (
            <span className="text-[#666]">voided</span>
          ) : (
            <button onClick={() => doVoid(s.saleId)} className="flex items-center gap-1 text-red-400 hover:text-red-300"><RotateCcw className="size-3" /> void</button>
          )}
        </div>
      ))}
    </div>
  );
}

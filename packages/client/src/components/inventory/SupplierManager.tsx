/**
 * @module components/inventory/SupplierManager
 *
 * Org-level supplier CRUD with full operational fields:
 * category, payment terms, ordering method, delivery days,
 * currency, location assignments, and linked items view.
 */

import { useState, useEffect, useCallback } from "react";
import {
  useSuppliers,
  useIngredientSuppliers,
  type Supplier,
  type IngredientSupplierLink,
} from "../../hooks/useInventory.js";
import { useLocation } from "../../context/LocationContext.js";
import {
  Plus, Search, Loader2, Truck, X, Check,
  ChevronDown, ChevronRight, Mail, Phone, Clock,
  DollarSign, Edit3, Package, MapPin, CreditCard,
  ShoppingCart, CalendarDays, Globe,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────

const SUPPLIER_CATEGORIES = [
  { key: "food", label: "Food & Beverage" },
  { key: "packaging", label: "Packaging" },
  { key: "cleaning", label: "Cleaning & Hygiene" },
  { key: "equipment", label: "Equipment & Maintenance" },
  { key: "multi", label: "Multi-Category" },
];

const PAYMENT_TERMS = [
  { key: "cod", label: "Cash on Delivery" },
  { key: "net_7", label: "Net 7 days" },
  { key: "net_14", label: "Net 14 days" },
  { key: "net_30", label: "Net 30 days" },
  { key: "net_60", label: "Net 60 days" },
  { key: "prepaid", label: "Prepaid" },
];

const ORDERING_METHODS = [
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "portal", label: "Online Portal" },
  { key: "edi", label: "EDI" },
  { key: "in_person", label: "In Person" },
];

const DAY_CHIPS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

const CURRENCIES = ["AUD", "USD", "NZD", "GBP", "EUR"];

const CAT_LABELS: Record<string, string> = Object.fromEntries(SUPPLIER_CATEGORIES.map((c) => [c.key, c.label]));
const PAY_LABELS: Record<string, string> = Object.fromEntries(PAYMENT_TERMS.map((c) => [c.key, c.label]));
const ORD_LABELS: Record<string, string> = Object.fromEntries(ORDERING_METHODS.map((c) => [c.key, c.label]));

// ─── Main Component ──────────────────────────────────────────────

export function SupplierManager() {
  const { suppliers, isLoading, create, update, remove } = useSuppliers();
  const [search, setSearch] = useState("");
  const [editSupplierId, setEditSupplierId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = suppliers.filter((s) =>
    !search || s.supplierName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4 animate-[fadeInUp_200ms_ease-out]">
      {/* Toolbar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666]" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search suppliers..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#161616] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50 transition-all"
          />
        </div>
        <button
          onClick={() => { setShowAdd(true); setError(null); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] text-sm font-semibold hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] transition-all active:scale-[0.98]"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {showAdd && (
        <SupplierForm
          title="New Supplier"
          onSave={async (data) => {
            try { setError(null); await create(data); setShowAdd(false); }
            catch (err: any) { setError(err.message); }
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 text-[#D4A574] animate-spin" />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-12 rounded-xl bg-[#161616] border border-[#2A2A2A]">
          <Truck className="size-8 mx-auto text-[#D4A574] mb-3" />
          <p className="text-sm text-white font-medium mb-1">
            {search ? "No matching suppliers" : "No suppliers yet"}
          </p>
          <p className="text-xs text-[#999]">Add your first supplier to get started.</p>
        </div>
      )}

      {/* Supplier table */}
      {!isLoading && filtered.length > 0 && (
        <div className="rounded-xl border border-[#2A2A2A] overflow-hidden">
          <div className="hidden sm:grid grid-cols-12 gap-1 px-4 py-2 text-[10px] text-[#666] uppercase tracking-wider bg-[#161616] border-b border-[#2A2A2A]">
            <div className="col-span-3">Supplier</div>
            <div className="col-span-2">Category</div>
            <div className="col-span-2">Contact</div>
            <div className="col-span-1">Lead</div>
            <div className="col-span-2">Payment</div>
            <div className="col-span-1">Order Via</div>
            <div className="col-span-1"></div>
          </div>

          {filtered.map((sup) => {
            const isExpanded = expandedId === sup.supplierId;
            const isEditing = editSupplierId === sup.supplierId;

            return (
              <div key={sup.supplierId} className="border-b border-[#2A2A2A]/30 last:border-b-0">
                {/* Compact row */}
                <div className={`grid grid-cols-12 gap-1 px-4 py-2.5 text-sm items-center transition-colors ${
                  isExpanded ? "bg-[#1E1E1E]/50" : "hover:bg-[#1E1E1E]/30"
                }`}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : sup.supplierId)}
                    className="col-span-3 flex items-center gap-1.5 text-left truncate"
                  >
                    {isExpanded ? <ChevronDown className="size-3 text-[#666] shrink-0" /> : <ChevronRight className="size-3 text-[#666] shrink-0" />}
                    <span className="text-white truncate">{sup.supplierName}</span>
                  </button>
                  <div className="col-span-2 text-xs text-[#999] hidden sm:block truncate">
                    {sup.supplierCategory ? CAT_LABELS[sup.supplierCategory] || sup.supplierCategory : "—"}
                  </div>
                  <div className="col-span-2 text-xs text-[#999] hidden sm:block truncate">
                    {sup.contactName || "—"}
                  </div>
                  <div className="col-span-1 text-xs text-[#999] tabular-nums hidden sm:block">
                    {sup.leadTimeDays ? `${sup.leadTimeDays}d` : "—"}
                  </div>
                  <div className="col-span-2 text-xs text-[#999] hidden sm:block truncate">
                    {sup.paymentTerms ? PAY_LABELS[sup.paymentTerms] || sup.paymentTerms : "—"}
                  </div>
                  <div className="col-span-1 text-xs text-[#999] hidden sm:block truncate">
                    {sup.orderingMethod ? ORD_LABELS[sup.orderingMethod] || sup.orderingMethod : "—"}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditSupplierId(isEditing ? null : sup.supplierId); }}
                      className="p-1 rounded-lg hover:bg-[#2A2A2A] text-[#666] hover:text-white transition-all"
                    >
                      <Edit3 className="size-3" />
                    </button>
                  </div>
                </div>

                {/* Expanded detail (read-only) */}
                {isExpanded && !isEditing && (
                  <SupplierDetail supplier={sup} />
                )}

                {/* Edit form */}
                {isEditing && (
                  <div className="border-t border-[#D4A574]/20">
                    <SupplierForm
                      title="Edit Supplier"
                      initial={sup}
                      onSave={async (data) => {
                        try {
                          setError(null);
                          await update(sup.supplierId, data);
                          setEditSupplierId(null);
                        } catch (err: any) { setError(err.message); }
                      }}
                      onCancel={() => setEditSupplierId(null)}
                      onDelete={async () => {
                        try { setError(null); await remove(sup.supplierId); setEditSupplierId(null); }
                        catch (err: any) { setError(err.message); }
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-[#666] text-center">{filtered.length} suppliers</p>
    </div>
  );
}

// ─── Supplier Detail (Read-Only Expanded) ────────────────────────

function SupplierDetail({ supplier: sup }: { supplier: Supplier }) {
  const deliveryDays = sup.deliveryDays ? sup.deliveryDays.split(",") : [];

  return (
    <div className="px-4 py-3 bg-[#0A0A0A]/50 border-t border-[#2A2A2A]/30 space-y-3 animate-[fadeIn_150ms_ease-out]">
      {/* Contact row */}
      <div className="flex flex-wrap gap-4 text-xs">
        {sup.contactEmail && (
          <span className="flex items-center gap-1.5 text-[#999]"><Mail className="size-3" /> {sup.contactEmail}</span>
        )}
        {sup.contactPhone && (
          <span className="flex items-center gap-1.5 text-[#999]"><Phone className="size-3" /> {sup.contactPhone}</span>
        )}
        {sup.currency && sup.currency !== "AUD" && (
          <span className="flex items-center gap-1.5 text-[#999]"><Globe className="size-3" /> {sup.currency}</span>
        )}
      </div>

      {/* Operational row */}
      <div className="flex flex-wrap gap-4 text-xs">
        {sup.leadTimeDays != null && (
          <span className="flex items-center gap-1.5 text-[#999]"><Clock className="size-3" /> {sup.leadTimeDays} day lead time</span>
        )}
        {sup.minimumOrderValue && (
          <span className="flex items-center gap-1.5 text-[#999]"><DollarSign className="size-3" /> ${Number(sup.minimumOrderValue).toFixed(2)} min order</span>
        )}
        {sup.orderingMethod && (
          <span className="flex items-center gap-1.5 text-[#999]"><ShoppingCart className="size-3" /> Order via {ORD_LABELS[sup.orderingMethod] || sup.orderingMethod}</span>
        )}
        {sup.paymentTerms && (
          <span className="flex items-center gap-1.5 text-[#999]"><CreditCard className="size-3" /> {PAY_LABELS[sup.paymentTerms] || sup.paymentTerms}</span>
        )}
      </div>

      {/* Delivery days */}
      {deliveryDays.length > 0 && (
        <div className="flex items-center gap-2">
          <CalendarDays className="size-3 text-[#666]" />
          <div className="flex gap-1">
            {DAY_CHIPS.map((d) => (
              <span key={d.key} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                deliveryDays.includes(d.key)
                  ? "bg-[#D4A574]/20 text-[#D4A574] border border-[#D4A574]/30"
                  : "text-[#444]"
              }`}>
                {d.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {sup.notes && <p className="text-xs text-[#666] italic">{sup.notes}</p>}
    </div>
  );
}

// ─── Supplier Form (Add + Edit) ──────────────────────────────────

function SupplierForm({
  title, initial, onSave, onCancel, onDelete,
}: {
  title: string;
  initial?: Supplier;
  onSave: (data: any) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const { locations } = useLocation();
  const [name, setName] = useState(initial?.supplierName || "");
  const [category, setCategory] = useState(initial?.supplierCategory || "");
  const [payment, setPayment] = useState(initial?.paymentTerms || "");
  const [ordering, setOrdering] = useState(initial?.orderingMethod || "");
  const [currency, setCurrency] = useState(initial?.currency || "AUD");
  const [deliveryDays, setDeliveryDays] = useState<Set<string>>(
    new Set(initial?.deliveryDays ? initial.deliveryDays.split(",") : []),
  );
  const [contactName, setContactName] = useState(initial?.contactName || "");
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail || "");
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone || "");
  const [leadTime, setLeadTime] = useState(initial?.leadTimeDays?.toString() || "");
  const [minOrder, setMinOrder] = useState(initial?.minimumOrderValue || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [selectedLocs, setSelectedLocs] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Load supplier locations for editing
  useEffect(() => {
    if (!initial) return;
    fetch(`/api/inventory/suppliers/${initial.supplierId}/locations`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : [])
      .then((locs: any[]) => setSelectedLocs(new Set(locs.filter((l) => l.activeInd).map((l) => l.storeLocationId))));
  }, [initial]);

  const toggleDay = (day: string) => {
    const next = new Set(deliveryDays);
    if (next.has(day)) next.delete(day); else next.add(day);
    setDeliveryDays(next);
  };

  const toggleLoc = (locId: string) => {
    const next = new Set(selectedLocs);
    if (next.has(locId)) next.delete(locId); else next.add(locId);
    setSelectedLocs(next);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({
      supplierName: name,
      supplierCategory: category || undefined,
      paymentTerms: payment || undefined,
      orderingMethod: ordering || undefined,
      deliveryDays: deliveryDays.size > 0 ? Array.from(deliveryDays).join(",") : undefined,
      currency: currency || "AUD",
      contactName: contactName || undefined,
      contactEmail: contactEmail || undefined,
      contactPhone: contactPhone || undefined,
      leadTimeDays: leadTime ? parseInt(leadTime) : undefined,
      minimumOrderValue: minOrder || undefined,
      notes: notes || undefined,
      locationIds: selectedLocs.size > 0 ? Array.from(selectedLocs) : undefined,
    });
    setSaving(false);
  };

  return (
    <div className="p-5 bg-[#161616] border border-[#D4A574]/20 rounded-xl animate-[scaleIn_200ms_ease-out]">
      <h4 className="text-sm font-semibold text-white mb-4">{title}</h4>

      <div className="space-y-3">
        {/* Row 1: Name + Category + Currency */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Supplier Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sysco Foods" autoFocus
              className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none focus:border-[#D4A574]/50" />
          </div>
          <div>
            <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
              <option value="">Select...</option>
              {SUPPLIER_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2: Contact */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Contact Person</label>
            <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)}
              placeholder="e.g. John Smith"
              className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Email</label>
            <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
              placeholder="e.g. john@sysco.com"
              className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Phone</label>
            <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
              placeholder="e.g. +61-3-9999-0000"
              className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
          </div>
        </div>

        {/* Row 3: Order terms */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Lead Time</label>
            <div className="relative">
              <input type="text" value={leadTime} onChange={(e) => setLeadTime(e.target.value)}
                placeholder="e.g. 2"
                className="w-full px-3 py-2 pr-14 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#666]">days</span>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Minimum Order</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-[#666]" />
              <input type="text" value={minOrder} onChange={(e) => setMinOrder(e.target.value)}
                placeholder="e.g. 150.00"
                className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Payment Terms</label>
            <select value={payment} onChange={(e) => setPayment(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
              <option value="">Select...</option>
              {PAYMENT_TERMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Order Via</label>
            <select value={ordering} onChange={(e) => setOrdering(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white focus:outline-none">
              <option value="">Select...</option>
              {ORDERING_METHODS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* Row 4: Delivery days */}
        <div>
          <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Delivery Days</label>
          <div className="flex gap-1.5">
            {DAY_CHIPS.map((d) => (
              <button key={d.key} type="button" onClick={() => toggleDay(d.key)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  deliveryDays.has(d.key)
                    ? "bg-[#D4A574]/20 text-[#D4A574] border-[#D4A574]/30"
                    : "bg-[#0A0A0A] text-[#666] border-[#2A2A2A] hover:border-[#3A3A3A]"
                }`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 5: Locations served */}
        {locations.length > 1 && (
          <div>
            <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">
              Locations Served
              <span className="text-[#555] ml-1">(leave empty = all locations)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {locations.map((loc) => (
                <label key={loc.storeLocationId} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] cursor-pointer hover:border-[#3A3A3A] transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedLocs.has(loc.storeLocationId)}
                    onChange={() => toggleLoc(loc.storeLocationId)}
                    className="rounded border-[#3A3A3A] bg-[#0A0A0A] text-[#D4A574] focus:ring-[#D4A574]/50"
                  />
                  <span className="text-xs text-white">{loc.locationName}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Row 6: Notes */}
        <div>
          <label className="text-[10px] text-[#666] uppercase tracking-wider block mb-1">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Premium seafood distributor, delivers Mon/Thu"
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-[#0A0A0A] border border-[#2A2A2A] text-sm text-white placeholder-[#666] focus:outline-none resize-none" />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between mt-4 pt-3 border-t border-[#2A2A2A]">
        <div>
          {onDelete && (
            <button onClick={onDelete}
              className="px-3 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-500/10 transition-colors">
              Deactivate
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm text-[#999] hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-all"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

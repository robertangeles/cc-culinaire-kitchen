/**
 * Form to add or edit a menu item.
 */

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";

interface MenuItemFormProps {
  onSubmit: (data: { name: string; category: string; sellingPrice: string }) => Promise<void>;
  categories: string[];
}

export function MenuItemForm({ onSubmit, categories }: MenuItemFormProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !sellingPrice) return;
    const cat = category === "__new" ? newCategory.trim() : category;
    if (!cat) return;
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), category: cat, sellingPrice });
      setName("");
      setSellingPrice("");
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-stone-200 p-4">
      <h3 className="text-sm font-semibold text-stone-800 mb-3">Add Menu Item</h3>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Item name"
          required
          className="px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        />
        <div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
            className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50 bg-white"
          >
            <option value="">Category...</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__new">+ New category</option>
          </select>
          {category === "__new" && (
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Category name"
              className="mt-1 w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50"
            />
          )}
        </div>
        <input
          type="number"
          step="0.01"
          min="0"
          value={sellingPrice}
          onChange={(e) => setSellingPrice(e.target.value)}
          placeholder="Selling price"
          required
          className="px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        />
        <button
          type="submit"
          disabled={saving}
          className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add
        </button>
      </div>
    </form>
  );
}

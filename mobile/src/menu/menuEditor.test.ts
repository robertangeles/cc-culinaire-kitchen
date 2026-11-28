import { describe, it, expect, vi } from "vitest";
import { editorItemCosts } from "@culinaire/shared";
import type { MenuCatalogueItem, MenuItem, MenuLine } from "@culinaire/shared/schemas/menu";
import { ApiError } from "../api/client";
import { blankLine, checkDraft, draftCosts, draftFromRecipe, draftOf, emptyDraft, linePreview, planLines, pickInto, saveMenuItem, saveSession, unitsFor, type DraftLine, type MenuDraft } from "./menuEditor";

const item = (over: Partial<MenuItem> = {}): MenuItem => ({
  menuItemId: "m1", userId: 4, name: "Margherita", category: "Pasta", sellingPrice: 24, servings: 2, servingsPerSale: 1, qFactorPct: 5, foodCost: 1, foodCostPct: 4, contributionMargin: 23, unitsSold: 12, menuMixPct: 60, classification: "star",
  containsDairyInd: false, containsGlutenInd: false, containsNutsInd: false, containsShellfishInd: false, containsEggsInd: false, isVegetarianInd: false, canManage: true, ...over,
});
const line = (over: Partial<MenuLine> = {}): MenuLine => ({ id: 1, ingredientId: "i1", ingredientName: "Mozzarella", note: null, quantity: 0.12, unit: "kg", unitCost: 14, yieldPct: 100, lineCost: 1.68, costStaleInd: false, baseUnit: "kg", contentQty: null, contentUnit: null, densityGPerMl: null, purchaseUnit: null, packQty: null, catalogUnitCost: 14, ...over });
const wine: MenuCatalogueItem = { ingredientId: "i9", ingredientName: "Wine", baseUnit: "bottle", ingredientCategory: "wine", contentQty: 750, contentUnit: "ml", densityGPerMl: null, purchaseUnit: "case", packQty: 6, preferredUnitCost: 18, unitCost: 20 };
const draft = (over: Partial<MenuDraft> = {}): MenuDraft => ({ ...draftOf(item(), [line()]), ...over });
const ok = (d: MenuDraft) => {
  const c = checkDraft(d);
  if ("error" in c) throw new Error(c.error);
  return c;
};

describe("the draft", () => {
  it("shows an item and its lines as typed text, a zero-cost linked line at the catalogue's cost as the web does", () => {
    const d = draftOf(item(), [line(), line({ id: 2, unitCost: 0, catalogUnitCost: 9.5 }), line({ id: 3, ingredientId: null, unitCost: undefined, catalogUnitCost: undefined, baseUnit: null })]);
    expect(d).toMatchObject({ name: "Margherita", sellingPrice: "24.00", servings: "2", servingsPerSale: "1", qFactorPct: "5", unitsSold: "12" });
    expect(d.lines.map((l) => [l.existingId, l.quantity, l.unitCost])).toEqual([[1, "0.12", "14"], [2, "0.12", "9.5"], [3, "0.12", ""]]);
  });

  it("links a picked catalogue item: its content unit, else its kitchen unit, and the preferred cost, else the catalogue's", () => {
    const picked = pickInto(blankLine(), wine);
    expect(picked).toMatchObject({ ingredientId: "i9", ingredientName: "Wine", unit: "ml", baseUnit: "bottle", unitCost: "18" });
    expect(pickInto(blankLine(), { ...wine, contentUnit: null, contentQty: null, preferredUnitCost: null })).toMatchObject({ unit: "bottle", unitCost: "20" });
    // Costs hidden from this person: nothing is carried over from the item picked before.
    expect(pickInto({ ...blankLine(), unitCost: "7" }, { ...wine, preferredUnitCost: undefined, unitCost: undefined })).toMatchObject({ unitCost: "" });
  });

  it("starts from a recipe without changing what its amounts mean: fractions, cups and pounds", () => {
    const d = draftFromRecipe({ recipeId: "r1", title: "Gnocchi", domain: "patisserie", yield: "Serves 4", ingredients: [
      { name: "Potato", amount: "1 1/2", unit: "lb", note: "floury" },
      { name: "Flour", amount: "1/2", unit: "cups", note: null },
      { name: "Milk", amount: "0,25", unit: "L", note: null },
      { name: "Salt", amount: "to taste", unit: "pinch", note: null },
    ] });
    expect(d).toMatchObject({ name: "Gnocchi", category: "Desserts", sellingPrice: "", servings: "4", servingsPerSale: "1" });
    expect(d.lines.map((l) => [l.ingredientName, l.quantity, l.unit, l.note])).toEqual([["Potato", "680.388", "g", "floury"], ["Flour", "0.5", "cup", null], ["Milk", "0.25", "L", null], ["Salt", "", "each", null]]);
  });
});

describe("the check before saving", () => {
  const error = (d: MenuDraft) => { const c = checkDraft(d); return "error" in c ? c.error : null; };

  it("accepts a complete draft, a comma as the decimal point, and drops a line left blank", () => {
    const c = ok(draft({ sellingPrice: "24,5", lines: [{ ...blankLine() }, { ...draftOf(item(), [line()]).lines[0], quantity: "0,2" }] }));
    expect(c.item).toEqual({ name: "Margherita", category: "Pasta", sellingPrice: "24.50", servings: 2, servingsPerSale: 1, qFactorPct: "5", unitsSold: 12 });
    expect(c.lines.map((l) => l.quantity)).toEqual(["0.2"]);
  });

  it("says what is missing or out of the server's range", () => {
    expect(error(draft({ name: " " }))).toMatch(/name/i);
    expect(error(draft({ category: "" }))).toMatch(/category/i);
    expect(error(draft({ category: "x".repeat(51) }))).toMatch(/category/i);
    expect(error(draft({ sellingPrice: "" }))).toMatch(/price/i);
    expect(error(draft({ sellingPrice: "1.234" }))).toMatch(/price/i);
    expect(error(draft({ sellingPrice: "100000000" }))).toMatch(/price/i);
    expect(error(draft({ servings: "0" }))).toMatch(/servings/i);
    expect(error(draft({ servingsPerSale: "1.5" }))).toMatch(/price covers/i);
    expect(error(draft({ qFactorPct: "51" }))).toMatch(/Q factor/i);
    expect(error(draft({ unitsSold: "-1" }))).toMatch(/units sold/i);
    const bad = (over: Partial<DraftLine>) => error(draft({ lines: [{ ...draftOf(item(), [line()]).lines[0], ...over }] }));
    expect(bad({ ingredientName: "" })).toMatch(/name/i);
    expect(bad({ quantity: "" })).toMatch(/Mozzarella/);
    expect(bad({ quantity: "0.1234" })).toMatch(/Mozzarella/);
    expect(bad({ unitCost: "x" })).toMatch(/cost of Mozzarella/);
    expect(bad({ yieldPct: "0" })).toMatch(/yield/i);
    expect(bad({ yieldPct: "201" })).toMatch(/yield/i);
    expect(bad({ yieldPct: "" })).toBeNull(); // the web's blank yield is 100%
  });
});

describe("the live preview, with the shared web editor's costing", () => {
  it("offers the units a linked item can be entered in (its own conversions too), and the web's list for a typed name", () => {
    expect(unitsFor(pickInto(blankLine(), wine), [])).toEqual(expect.arrayContaining(["ml", "bottle", "case"]));
    expect(unitsFor(pickInto(blankLine(), wine), [{ fromUnit: "carafe", toBaseFactor: 0.5 }])).toContain("carafe");
    expect(unitsFor(blankLine(), [])).toContain("fl oz");
    // A unit the resolver does not offer stays on the list, so the line does not silently change unit.
    expect(unitsFor({ ...pickInto(blankLine(), wine), unit: "bunch" }, [])[0]).toBe("bunch");
  });

  it("costs a line in its kitchen unit, says when a unit has no path, and shows no cost for a line without one, linked or typed, rather than $0", () => {
    const glass = { ...pickInto(blankLine(), wine), quantity: "150" };
    expect(linePreview(glass, [])).toEqual({ cost: 3.6, mismatch: false });
    expect(linePreview({ ...glass, unit: "kg" }, [])).toEqual({ cost: 0, mismatch: true });
    expect(linePreview({ ...glass, unitCost: "" }, [])).toEqual({ cost: null, mismatch: false });
    expect(linePreview({ ...blankLine(), ingredientName: "Salt", quantity: "1" }, [])).toEqual({ cost: null, mismatch: false });
    expect(linePreview({ ...glass, quantity: "150,0", yieldPct: "50" }, [])).toEqual({ cost: 7.2, mismatch: false });
  });

  it("totals the batch and matches the shared editor figures", () => {
    const d = draft({ lines: draftOf(item(), [line(), line({ id: 2, quantity: 1 })]).lines });
    expect(draftCosts(d, () => [])).toEqual({ batch: 15.68, ...editorItemCosts({ totalBatchCost: 15.68, servings: 2, qFactorPct: "5", servingsPerSale: 1, sellingPrice: "24.00" }) });
  });
});

describe("which lines to write", () => {
  const kept = line({ id: 1 });
  const base = [kept, line({ id: 2, ingredientName: "Basil", ingredientId: null, unitCost: 3 })];
  const d = draftOf(item(), base);

  it("writes nothing for untouched lines, and never removes a line a colleague added meanwhile", () => {
    expect(planLines(d.lines, base, [...base, line({ id: 9, ingredientName: "Oil" })])).toEqual({ add: [], remove: [] });
  });

  it("replaces a changed line, adds a new one and removes a deleted one", () => {
    const changed = { ...d.lines[0], quantity: "0.2" };
    const plan = planLines([changed, { ...blankLine(), ingredientName: "Oil", quantity: "1", unit: "L" }], base, base);
    expect(plan.add.map((l) => [l.ingredientName, l.quantity])).toEqual([["Mozzarella", "0.2"], ["Oil", "1"]]);
    expect(plan.remove).toEqual([1, 2]);
  });

  it("does not add again a line that reached the server before a reply was lost", () => {
    const fresh = { ...blankLine(), ingredientName: "Oil", quantity: "1", unit: "L", unitCost: "" };
    expect(planLines([...d.lines, fresh], base, [...base, line({ id: 9, ingredientId: null, ingredientName: "Oil", quantity: 1, unit: "L", unitCost: 0, baseUnit: null })])).toEqual({ add: [], remove: [] });
    // Two identical new lines, one landed: one more is added.
    expect(planLines([...d.lines, fresh, { ...fresh, key: "z" }], base, [...base, line({ id: 9, ingredientId: null, ingredientName: "Oil", quantity: 1, unit: "L", unitCost: 0, baseUnit: null })]).add).toHaveLength(1);
  });

  it("does not bring back a line a colleague removed meanwhile, unless this person changed it", () => {
    expect(planLines(d.lines, base, [kept])).toEqual({ add: [], remove: [] });
  });
});

describe("saving", () => {
  function server(items: MenuItem[] = [], lines: MenuLine[] = []) {
    const calls: string[] = [];
    let nextLine = 100;
    const api = {
      items: vi.fn(async () => [...items]),
      lines: vi.fn(async () => [...lines]),
      create: vi.fn(async (body: { name: string; category: string; sellingPrice: string; servings: number }) => {
        calls.push("create");
        items.push(item({ menuItemId: `new${items.length}`, name: body.name, category: body.category, sellingPrice: Number(body.sellingPrice), servings: body.servings, qFactorPct: 0, unitsSold: 0 }));
        return { menuItemId: `new${items.length - 1}` };
      }),
      update: vi.fn(async (_id: string, changes: object) => void calls.push(`update ${JSON.stringify(changes)}`)),
      addLine: vi.fn(async (_id: string, l: { ingredientName: string; quantity: string }) => {
        calls.push(`add ${l.ingredientName} ${l.quantity}`);
        lines.push(line({ id: ++nextLine, ingredientId: null, baseUnit: null, ...l, quantity: Number(l.quantity), unitCost: 0, yieldPct: 100 } as Partial<MenuLine>));
      }),
      removeLine: vi.fn(async (_id: string, rowId: number) => {
        calls.push(`remove ${rowId}`);
        lines.splice(lines.findIndex((l) => l.id === rowId), 1);
      }),
    };
    return { api, calls, items, lines };
  }
  const lost = new ApiError("timeout");
  const fresh = (over: Partial<MenuDraft> = {}) => ok({ ...emptyDraft(), name: "Gnocchi", category: "Pasta", sellingPrice: "22", lines: [{ ...blankLine(), ingredientName: "Potato", quantity: "0.5", unit: "kg" }], ...over });

  it("creates an item, then its lines, without a unit cost nobody typed and without units sold", async () => {
    const s = server();
    expect(await saveMenuItem(s.api, saveSession(), fresh(), 4)).toBe("new0");
    expect(s.calls).toEqual(["create", "add Potato 0.5"]);
    expect(s.api.create.mock.calls[0][0]).toEqual({ name: "Gnocchi", category: "Pasta", sellingPrice: "22.00", servings: 1, servingsPerSale: 1, qFactorPct: "0" });
    expect(s.api.addLine.mock.calls[0][1]).toEqual({ ingredientId: null, ingredientName: "Potato", note: null, quantity: "0.5", unit: "kg", yieldPct: "100" });
  });

  it("sends only what changed on an edit, so a sale recorded meanwhile keeps its units sold", async () => {
    const s = server([item()], [line()]);
    const session = saveSession(item(), [line()]);
    await saveMenuItem(s.api, session, ok(draft({ sellingPrice: "26" })), 4);
    expect(s.calls).toEqual(['update {"sellingPrice":"26.00"}']);
    await saveMenuItem(s.api, session, ok(draft({ sellingPrice: "26" })), 4);
    expect(s.calls).toHaveLength(1);
  });

  it("adds the new version of a changed line before removing the old one", async () => {
    const s = server([item()], [line()]);
    const d = draft();
    await saveMenuItem(s.api, saveSession(item(), [line()]), ok({ ...d, lines: [{ ...d.lines[0], quantity: "0.2" }] }), 4);
    expect(s.calls).toEqual(["add Mozzarella 0.2", "remove 1"]);
  });

  it("sends a changed line's own cost again when the server showed it", async () => {
    const s = server([item()], [line()]);
    const d = draft();
    await saveMenuItem(s.api, saveSession(item(), [line()]), ok({ ...d, lines: [{ ...d.lines[0], quantity: "0.2" }] }), 4);
    expect(s.api.addLine.mock.calls[0][1]).toMatchObject({ unitCost: "14" });
  });

  it("sends a changed line whose cost is hidden without one, before the old one goes, so the server can carry the cost over; untouched lines stay", async () => {
    const hidden = [line({ unitCost: undefined, lineCost: undefined, catalogUnitCost: undefined }), line({ id: 2, ingredientName: "Basil", ingredientId: null, baseUnit: null, unitCost: undefined, lineCost: undefined, catalogUnitCost: undefined })];
    const s = server([item()], [...hidden]);
    const d = draftOf(item(), hidden);
    await saveMenuItem(s.api, saveSession(item(), hidden), ok({ ...d, lines: [{ ...d.lines[0], quantity: "0.2" }, d.lines[1]] }), 4);
    expect(s.calls).toEqual(["add Mozzarella 0.2", "remove 1"]);
    expect(s.api.addLine.mock.calls[0][1]).not.toHaveProperty("unitCost");
  });

  it("finds the item a lost create reply left on the server instead of making a second one, and saves what was typed since", async () => {
    const s = server([item({ menuItemId: "old", name: "Gnocchi", sellingPrice: 22 })]);
    s.api.create.mockImplementationOnce(async (body) => {
      s.items.push(item({ menuItemId: "landed", name: body.name, category: body.category, sellingPrice: Number(body.sellingPrice), servings: 1, qFactorPct: 0, unitsSold: 0 }));
      throw lost;
    });
    const session = saveSession();
    await expect(saveMenuItem(s.api, session, fresh(), 4)).rejects.toBe(lost);
    expect(await saveMenuItem(s.api, session, fresh({ sellingPrice: "23" }), 4)).toBe("landed");
    expect(s.api.create).toHaveBeenCalledTimes(1);
    expect(s.calls).toEqual(['update {"sellingPrice":"23.00"}', "add Potato 0.5"]);
  });

  it("creates again when the first try never reached the server, and does not take a colleague's item of the same name", async () => {
    const s = server();
    s.api.create.mockImplementationOnce(async () => {
      s.items.push(item({ menuItemId: "theirs", userId: 9, name: "Gnocchi", sellingPrice: 22 }));
      throw lost;
    });
    const session = saveSession();
    await expect(saveMenuItem(s.api, session, fresh(), 4)).rejects.toBe(lost);
    expect(await saveMenuItem(s.api, session, fresh(), 4)).toBe("new1");
  });

  it("sends nothing when the list cannot be read first", async () => {
    const s = server();
    s.api.items.mockRejectedValueOnce(new ApiError("network"));
    await expect(saveMenuItem(s.api, saveSession(), fresh(), 4)).rejects.toMatchObject({ code: "network" });
    expect(s.calls).toEqual([]);
  });

  it("carries on after a line the server refused: the item is not created twice and saved lines are not added twice", async () => {
    const s = server();
    const two = fresh({ lines: [{ ...blankLine(), ingredientName: "Potato", quantity: "0.5", unit: "kg" }, { ...blankLine(), ingredientName: "Flour", quantity: "0.1", unit: "kg" }] });
    const addLine = s.api.addLine.getMockImplementation()!;
    s.api.addLine.mockImplementationOnce(addLine).mockRejectedValueOnce(new ApiError("bad_request", "Invalid quantity", 400));
    const session = saveSession();
    await expect(saveMenuItem(s.api, session, two, 4)).rejects.toThrow("Invalid quantity");
    expect(session.itemId).toBe("new0");
    await saveMenuItem(s.api, session, two, 4);
    expect(s.calls).toEqual(["create", "add Potato 0.5", "add Flour 0.1"]);
  });

  describe("saving again after the form changed between a failed save and the retry", () => {
    const basil = (over: Partial<MenuLine> = {}) => line({ id: 1, ingredientId: null, baseUnit: null, ingredientName: "Basil", quantity: 1, unit: "kg", unitCost: undefined, lineCost: undefined, catalogUnitCost: undefined, ...over });
    const row = (d: MenuDraft, i: number, over: Partial<DraftLine>): DraftLine => ({ ...d.lines[i], ...over });
    const salt = { ...blankLine(), ingredientName: "Salt", quantity: "1", unit: "kg" };
    const contents = (lines: MenuLine[]) => lines.map((l) => `${l.ingredientName} ${l.quantity}`).sort();
    const saltDown = (s: ReturnType<typeof server>) => {
      const add = s.api.addLine.getMockImplementation()!;
      const down = { on: true };
      s.api.addLine.mockImplementation(async (id, l) => {
        if (down.on && l.ingredientName === "Salt") throw lost;
        return add(id, l);
      });
      return down;
    };

    it("removes the copy this save added, so the recipe does not hold both versions of an edited line", async () => {
      const start = [basil()];
      const s = server([item()], [...start]);
      const session = saveSession(item(), start);
      const d = draftOf(item(), start);
      const down = saltDown(s);
      await expect(saveMenuItem(s.api, session, ok({ ...d, lines: [row(d, 0, { quantity: "2" }), salt] }), 4)).rejects.toBe(lost);
      expect(contents(s.lines)).toEqual(["Basil 1", "Basil 2"]);
      down.on = false;
      await saveMenuItem(s.api, session, ok({ ...d, lines: [row(d, 0, { quantity: "3" }), salt] }), 4);
      expect(contents(s.lines)).toEqual(["Basil 3", "Salt 1"]);
    });

    it("does the same after a create whose first line landed and second did not", async () => {
      const s = server();
      const session = saveSession();
      const two = (q: string) => fresh({ lines: [{ ...blankLine(), ingredientName: "Basil", quantity: q, unit: "kg" }, salt] });
      const down = saltDown(s);
      await expect(saveMenuItem(s.api, session, two("2"), 4)).rejects.toBe(lost);
      down.on = false;
      await saveMenuItem(s.api, session, two("3"), 4);
      expect(contents(s.lines)).toEqual(["Basil 3", "Salt 1"]);
      expect(s.api.create).toHaveBeenCalledTimes(1);
    });

    it("removes a line whose add landed but whose reply was lost", async () => {
      const start = [basil()];
      const s = server([item()], [...start]);
      const session = saveSession(item(), start);
      const d = draftOf(item(), start);
      const add = s.api.addLine.getMockImplementation()!;
      s.api.addLine.mockImplementationOnce(async (id, l) => { await add(id, l); throw lost; });
      await expect(saveMenuItem(s.api, session, ok({ ...d, lines: [row(d, 0, { quantity: "2" })] }), 4)).rejects.toBe(lost);
      await saveMenuItem(s.api, session, ok({ ...d, lines: [row(d, 0, { quantity: "3" })] }), 4);
      expect(contents(s.lines)).toEqual(["Basil 3"]);
    });

    it("keeps a colleague's line, even one with the content of a line this save added and gave up", async () => {
      const start = [basil()];
      const s = server([item()], [...start, basil({ id: 50, quantity: 2 })]);
      const session = saveSession(item(), start);
      const d = draftOf(item(), start);
      const down = saltDown(s);
      const both = (q: string) => ok({ ...d, lines: [row(d, 0, { quantity: q }), { ...row(d, 0, { quantity: q }), key: "second", existingId: undefined }, salt] });
      await expect(saveMenuItem(s.api, session, both("2"), 4)).rejects.toBe(lost);
      expect(s.lines.filter((l) => l.quantity === 2)).toHaveLength(2);
      down.on = false;
      await saveMenuItem(s.api, session, both("3"), 4);
      expect(s.lines.find((l) => l.id === 50)).toBeDefined();
      expect(contents(s.lines)).toEqual(["Basil 2", "Basil 3", "Basil 3", "Salt 1"]);
    });
  });
});

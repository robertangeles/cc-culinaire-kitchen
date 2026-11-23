import { describe, it, expect, vi } from "vitest";
import type { KvStore } from "../storage/kv";
import { ApiError, type ApiClient } from "../api/client";
import { createCatalogue } from "./catalogue";
import { createRecents } from "./recents";
import { createIngredientSource, rankIngredients } from "./source";

const memoryKv = (): KvStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
};
const item = (name: string, over: object = {}) => ({ ingredientId: `id-${name}`, ingredientName: name, baseUnit: "kg", ingredientCategory: "", ...over });

describe("ranking what the person typed", () => {
  const items = ["Chicken thigh", "Smoked chicken", "Chickpeas", "Chilli flakes", "Brie", "Pickled chilli"].map((n) => ({ name: n }));

  it("puts names that start with the text first, then words that start with it, then the rest, ignoring case and accents", () => {
    expect(rankIngredients("chi", items, 10).map((i) => i.name)).toEqual(["Chicken thigh", "Chickpeas", "Chilli flakes", "Smoked chicken", "Pickled chilli"]);
    expect(rankIngredients("CHILLI", items, 10).map((i) => i.name)).toEqual(["Chilli flakes", "Pickled chilli"]);
    expect(rankIngredients("jalapeno", [{ name: "Jalapeño" }], 10)).toHaveLength(1);
  });

  it("is limited, and empty text matches nothing (the screen shows recent items for that)", () => {
    expect(rankIngredients("c", items, 2)).toHaveLength(2);
    expect(rankIngredients("  ", items, 5)).toEqual([]);
  });
});

describe("recent items", () => {
  it("keeps the newest first, one per name whatever its case, and no more than the limit", async () => {
    const kv = memoryKv();
    const recents = createRecents<{ name: string; unit?: string }>({ kv, key: "r", max: 3 });
    await recents.remember({ name: "Basil", unit: "bunch" });
    await recents.remember({ name: "Gin" });
    await recents.remember({ name: "basil", unit: "kg" });
    await recents.remember({ name: "Flour" });
    await recents.remember({ name: "Salt" });
    expect((await recents.list()).map((r) => r.name)).toEqual(["Salt", "Flour", "basil"]);
    expect((await recents.list())[2].unit).toBe("kg");
  });

  it("survives a closed app, and a damaged note is treated as empty", async () => {
    const kv = memoryKv();
    await createRecents({ kv, key: "r", max: 5 }).remember({ name: "Basil" });
    expect(await createRecents({ kv, key: "r", max: 5 }).list()).toEqual([{ name: "Basil" }]);
    kv.data.set("r", "{not json");
    expect(await createRecents({ kv, key: "r", max: 5 }).list()).toEqual([]);
  });
});

describe("the catalogue the picker searches", () => {
  const rows = [{ ingredientId: "i1", ingredientName: "Flour", baseUnit: "g", ingredientCategory: "Dry", itemType: "KITCHEN_INGREDIENT", unitCost: "0.01" }];

  it("downloads once, keeps only what the picker needs, and reads it back with no signal", async () => {
    const kv = memoryKv();
    const request = vi.fn(async () => rows);
    const cat = createCatalogue({ client: { request } as unknown as ApiClient, kv, key: "cat" });
    expect(await cat.refresh()).toBe(true);
    expect(request).toHaveBeenCalledWith("GET", "/api/inventory/ingredients", expect.any(Object));
    const offline = createCatalogue({ client: { request: async () => { throw new ApiError("network"); } } as unknown as ApiClient, kv, key: "cat" });
    expect(await offline.items()).toEqual([{ ingredientId: "i1", ingredientName: "Flour", baseUnit: "g", ingredientCategory: "Dry", itemType: "KITCHEN_INGREDIENT" }]);
    expect(await offline.refresh()).toBe(false);
    expect((await offline.items())).toHaveLength(1); // a failed refresh keeps the last download
  });

  it("is empty, not an error, for someone the server will not give the catalogue to (a cook who may log waste but not count stock)", async () => {
    const cat = createCatalogue({ client: { request: async () => { throw new ApiError("forbidden", "no", 403); } } as unknown as ApiClient, kv: memoryKv(), key: "cat" });
    expect(await cat.refresh()).toBe(false);
    expect(await cat.items()).toEqual([]);
  });
});

describe("the ingredient source", () => {
  const setup = async (more?: (q: string) => Promise<string[]>) => {
    const kv = memoryKv();
    const catalogue = { items: async () => [item("Chicken thigh"), item("Chickpeas", { baseUnit: "g" })], refresh: async () => true };
    const recents = createRecents<{ name: string; ingredientId?: string; unit?: string }>({ kv, key: "r", max: 8 });
    await recents.remember({ name: "Chicken stock", unit: "L" });
    return createIngredientSource({ catalogue, recents, moreNames: more });
  };

  it("offers recent items before anything is typed", async () => {
    expect((await (await setup()).recent()).map((r) => r.name)).toEqual(["Chicken stock"]);
  });

  it("searches the downloaded catalogue and recent items together, with the item's own unit, no duplicates", async () => {
    const found = await (await setup()).search("chick");
    expect(found.map((f) => [f.name, f.unit])).toEqual([["Chicken stock", "L"], ["Chicken thigh", "kg"], ["Chickpeas", "g"]]);
  });

  it("adds names from the server's own history when it can be reached, and ignores it when it cannot", async () => {
    const source = await setup(async () => ["Chicken wings", "chicken thigh"]);
    expect((await source.searchMore!("chick")).map((f) => f.name)).toEqual(["Chicken wings"]); // the thigh is already offered
    const dead = await setup(async () => { throw new ApiError("network"); });
    expect(await dead.searchMore!("chick")).toEqual([]);
  });

  it("remembers what was picked so it comes back first", async () => {
    const source = await setup();
    await source.remember({ name: "Chickpeas", ingredientId: "id-Chickpeas", unit: "g" });
    expect((await source.recent())[0]).toMatchObject({ name: "Chickpeas", unit: "g" });
  });
});

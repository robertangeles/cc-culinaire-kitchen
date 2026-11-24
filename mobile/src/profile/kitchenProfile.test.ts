import { describe, it, expect } from "vitest";
import { KitchenProfileSchema } from "@culinaire/shared/schemas/account";
import { servings, toChanges, toForm } from "./kitchenProfile";

const saved = KitchenProfileSchema.parse({
  skillLevel: "head_chef",
  cuisinePreferences: ["Italian"],
  servingsDefault: 6,
  establishmentType: "Night market stall",
  sourcingValues: ["organic", "Our own garden"],
  pricePoint: "mid_range",
});

describe("the kitchen profile form", () => {
  it("shows an establishment type or sourcing value outside the fixed list as the person's own 'Other' text", () => {
    const f = toForm(saved);
    expect(f).toMatchObject({ establishmentType: "other", establishmentTypeOther: "Night market stall", sourcingValues: ["organic"], sourcingOther: "Our own garden", servingsDefault: "6" });
    expect(toForm(KitchenProfileSchema.parse({ establishmentType: "cafe_bakery" })).establishmentType).toBe("cafe_bakery");
  });

  it("sends the 'Other' text back as the value, as the web does", () => {
    const changes = toChanges(toForm(saved), true);
    expect(changes).toMatchObject({ establishmentType: "Night market stall", sourcingValues: ["organic", "Our own garden"], servingsDefault: 6, pricePoint: "mid_range", restaurantName: null });
  });

  it("sends only the skill level for someone who is not an organisation admin", () => {
    expect(toChanges({ ...toForm(saved), restaurantName: "Mine now" }, false)).toEqual({ skillLevel: "head_chef" });
  });

  it("refuses default servings the server would refuse", () => {
    expect(servings("4")).toBe(4);
    expect(servings("0")).toBeNull();
    expect(servings("101")).toBeNull();
    expect(servings("2.5")).toBeNull();
    expect(servings("")).toBeNull();
  });
});

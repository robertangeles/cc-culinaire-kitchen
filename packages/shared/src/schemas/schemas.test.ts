import { describe, it, expect } from "vitest";
import { ApiErrorBodySchema, UpgradeRequiredBodySchema, normaliseCode } from "./errors.js";
import { SitePageSchema } from "./legal.js";
import { AuthUserSchema, LocationContextSchema, LoginReplySchema, RefreshReplySchema } from "./auth.js";
import { ActiveSessionSchema, AreaLinesSchema, CountSheetsSchema, SubmitConflictBodySchema } from "./stockTake.js";
import { WasteEntrySchema, WasteListSchema, WasteSuggestionsSchema } from "./waste.js";
import { CatalogueSchema } from "./catalogue.js";
import { CreatePurchaseOrderSchema, PurchaseOrderInputSchema, PurchaseOrderSchema } from "./purchaseOrder.js";
import { CatalogRequestListSchema } from "./catalogRequest.js";
import { PrepMenuSchema, PrepSelectionsSchema, PrepTodaySchema } from "./prep.js";
import { ConsumptionEntrySchema, ConsumptionListSchema } from "./consumption.js";
import { StockMovementListSchema, StorageAreaListSchema } from "./stockMovement.js";
import { ConversationDetailSchema, ConversationListSchema } from "./conversation.js";
import { GenerateReplySchema, RecipePageSchema, RecipeSchema, RefineReplySchema, parseRecipeData } from "./recipe.js";
import { AppNotificationListSchema, UnreadCountSchema } from "./notifications.js";
import { KitchenProfileSchema, MfaSetupReplySchema, PersonalisationOptionsSchema, ProfileDetailsReplySchema } from "./account.js";

// Payloads are shaped like the real server replies. Each lenient rule is one case: the point is that a server
// that moved on (new field, new enum value, new null) does not break a phone that was installed last month.

const user = { userId: 7, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles: ["Subscriber"], permissions: ["inventory:count"] };

describe("auth schemas", () => {
  it("ignores fields the phone does not know", () => {
    expect(AuthUserSchema.parse({ ...user, brandNewField: { a: 1 } })).toEqual(user);
  });

  it("only requires what a screen cannot work without", () => {
    expect(AuthUserSchema.parse({ userId: 7 })).toEqual({ userId: 7, userName: "", userEmail: "", mfaEnabled: false, roles: [], permissions: [] });
    expect(AuthUserSchema.safeParse({ userName: "no id" }).success).toBe(false);
  });

  it("reads a password login, an MFA challenge and a rotated or unrotated refresh", () => {
    expect(LoginReplySchema.parse({ user, tokens: { accessToken: "a", refreshToken: "r" } }).tokens?.refreshToken).toBe("r");
    expect(LoginReplySchema.parse({ requiresMfa: true, mfaSessionToken: "m" })).toMatchObject({ requiresMfa: true, mfaSessionToken: "m" });
    expect(RefreshReplySchema.parse({ tokens: { accessToken: "a2" } }).tokens.refreshToken).toBeUndefined();
    expect(RefreshReplySchema.parse({ tokens: { accessToken: "a2", refreshToken: "r2" } }).tokens.refreshToken).toBe("r2");
  });

  it("reads the location context, with null for nothing selected", () => {
    const loc = { storeLocationId: "L1", organisationId: 1, locationName: "Main", classification: "RESTAURANT" };
    expect(LocationContextSchema.parse({ locations: [loc], selectedLocationId: null, organisationId: 1, isOrgAdmin: false, hasLocationAccess: true }).selectedLocationId).toBeNull();
    expect(LocationContextSchema.parse({ locations: [loc] }).hasLocationAccess).toBe(false);
  });
});

describe("stock take schemas", () => {
  const category = { categoryId: "c1", categoryName: "Bar", categoryStatus: "IN_PROGRESS", claimedByUserId: 7, claimedByUserName: "Chef", claimRevision: 2 };

  it("reads the open session, and null when none is open (also an empty body)", () => {
    const session = { sessionId: "s1", sessionStatus: "OPEN", countMode: "AREA", locationName: "Main", categories: [category], extra: true };
    expect(ActiveSessionSchema.parse(session)?.categories[0].claimRevision).toBe(2);
    expect(ActiveSessionSchema.parse(null)).toBeNull();
    expect(ActiveSessionSchema.parse(undefined)).toBeNull();
  });

  it("treats a count mode it does not know as the one the phone cannot count", () => {
    expect(ActiveSessionSchema.parse({ sessionId: "s1", sessionStatus: "OPEN", countMode: "ZONE", categories: [] })?.countMode).toBe("CATEGORY");
  });

  it("keeps a status it does not know as plain text", () => {
    expect(ActiveSessionSchema.parse({ sessionId: "s", sessionStatus: "PAUSED", countMode: "AREA", categories: [{ ...category, categoryStatus: "ON_HOLD", claimRevision: "x" }] })?.categories[0]).toMatchObject({ categoryStatus: "ON_HOLD", claimRevision: 0 });
  });

  it("turns the numeric strings of line quantities into numbers", () => {
    expect(AreaLinesSchema.parse([{ ingredientId: "i1", rawQty: "12.500", countedUnit: "kg", unitCost: "3.2" }])).toEqual([{ ingredientId: "i1", rawQty: 12.5, countedUnit: "kg" }]);
    expect(AreaLinesSchema.parse([{ ingredientId: "i1", rawQty: 3, countedUnit: "L" }])[0].rawQty).toBe(3);
    expect(AreaLinesSchema.safeParse([{ ingredientId: "i1", rawQty: "abc", countedUnit: "L" }]).success).toBe(false);
  });

  it("reads a count sheet whose item lists no other areas", () => {
    const parsed = CountSheetsSchema.parse({ areas: [{ categoryId: "c1", categoryName: "Bar", items: [{ ingredientId: "i1", ingredientName: "Gin", countUnit: "L" }] }] });
    expect(parsed.areas[0].items[0].alsoIn).toEqual([]);
  });

  it("reads the missing list of a submit conflict", () => {
    expect(SubmitConflictBodySchema.parse({ error: "Count these", missing: [{ ingredientId: "i1", ingredientName: "Gin", areaNames: ["Bar"] }] }).missing).toHaveLength(1);
  });
});

describe("error body", () => {
  it("reads a sentence and a code", () => {
    expect(ApiErrorBodySchema.parse({ error: "Nope", code: "ALREADY_CONFIRMED" })).toEqual({ error: "Nope", code: "ALREADY_CONFIRMED" });
  });

  it("reads the older bodies: an error object, no code, a code that is not text, or nothing useful", () => {
    expect(ApiErrorBodySchema.parse({ error: { message: "Bad" } })).toEqual({ error: "Bad", code: undefined });
    expect(ApiErrorBodySchema.parse({ error: "x", code: 7 })).toEqual({ error: "x", code: undefined });
    expect(ApiErrorBodySchema.parse({ error: { issues: [] } })).toEqual({ error: undefined, code: undefined });
  });

  it("compares codes in one spelling", () => {
    expect(normaliseCode(" upgrade_required ")).toBe("UPGRADE_REQUIRED");
  });
});

describe("update-required body (the 426)", () => {
  it("reads the minimum and the store links", () => {
    expect(UpgradeRequiredBodySchema.parse({ error: "Update", code: "upgrade_required", minVersion: "1.2.0", storeUrls: { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x" } })).toEqual({
      minVersion: "1.2.0",
      storeUrls: { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x" },
    });
  });

  it("has no links when the server sent none, and drops a link that is not https (the phone opens what this holds)", () => {
    expect(UpgradeRequiredBodySchema.parse({ minVersion: "1.2.0" }).storeUrls).toBeUndefined();
    expect(UpgradeRequiredBodySchema.parse({ minVersion: "1.2.0", storeUrls: { ios: "javascript:alert(1)", android: "http://play.google.com/x" } }).storeUrls).toEqual({ ios: undefined, android: undefined });
  });

  it("still reads a body with no usable fields: the phone shows the update screen without a version or link", () => {
    expect(UpgradeRequiredBodySchema.parse({ minVersion: 3, storeUrls: "x" })).toEqual({ minVersion: "", storeUrls: undefined });
    expect(UpgradeRequiredBodySchema.parse(undefined)).toEqual({ minVersion: "", storeUrls: undefined });
  });
});

describe("site page (terms, privacy)", () => {
  it("reads the title and the text, and ignores the rest", () => {
    expect(SitePageSchema.parse({ pageId: "p", slug: "terms", surface: "mobile", title: "Terms of Service", bodyMd: "# Hi", publishedInd: true })).toEqual({ title: "Terms of Service", bodyMd: "# Hi" });
  });

  it("needs a title; a missing body is empty text", () => {
    expect(SitePageSchema.parse({ title: "Privacy" })).toEqual({ title: "Privacy", bodyMd: "" });
    expect(SitePageSchema.safeParse({ bodyMd: "x" }).success).toBe(false);
  });
});

describe("waste schemas", () => {
  const row = { wasteLogId: "w1", userId: 7, storeLocationId: "L1", ingredientName: "Chicken trim", quantity: 2.5, unit: "kg", estimatedCost: null, reason: "Trim/Peel", notes: null, shift: "Lunch", loggedAt: "2026-11-23T01:00:00.000Z", createdDttm: "2026-11-23T01:00:01.000Z", loggedBy: "Rob", brandNew: 1 };

  it("reads a waste row, ignoring what it does not know, and numeric strings from older replies", () => {
    expect(WasteEntrySchema.parse(row)).toMatchObject({ wasteLogId: "w1", quantity: 2.5, estimatedCost: null });
    expect(WasteEntrySchema.parse({ ...row, quantity: "2.500", estimatedCost: "4.20" })).toMatchObject({ quantity: 2.5, estimatedCost: 4.2 });
    expect(WasteEntrySchema.parse({ wasteLogId: "w2", ingredientName: "Basil", quantity: 1, unit: "bunch", loggedAt: "2026-11-23T01:00:00.000Z" })).toMatchObject({ reason: null, shift: null, notes: null, estimatedCost: null, storeLocationId: null });
  });

  it("one bad row in a list does not hide the others", () => {
    const list = WasteListSchema.parse({ data: [row, { nonsense: true }, { ...row, wasteLogId: "w3" }], total: 3 });
    expect(list.data.map((r) => r.wasteLogId)).toEqual(["w1", "w3"]);
  });

  it("reads suggestions, and no suggestions", () => {
    expect(WasteSuggestionsSchema.parse({ ingredients: ["Basil", "Basmati"] })).toEqual(["Basil", "Basmati"]);
    expect(WasteSuggestionsSchema.parse({})).toEqual([]);
  });
});

describe("catalogue schema", () => {
  it("keeps only what the picker needs and drops rows that cannot be picked", () => {
    const rows = CatalogueSchema.parse([
      { ingredientId: "i1", ingredientName: "Flour", baseUnit: "g", ingredientCategory: "Dry", itemType: "KITCHEN_INGREDIENT", unitCost: "0.0012", organisationId: 1 },
      { ingredientName: "no id" },
      { ingredientId: "i2", ingredientName: "Gin", baseUnit: "L" },
    ]);
    expect(rows).toEqual([
      { ingredientId: "i1", ingredientName: "Flour", baseUnit: "g", ingredientCategory: "Dry", itemType: "KITCHEN_INGREDIENT" },
      { ingredientId: "i2", ingredientName: "Gin", baseUnit: "L", ingredientCategory: "" },
    ]);
  });

  it("reads the waste picker list (id, name, unit) as the same catalogue", () => {
    const list = [{ ingredientId: "i1", ingredientName: "Flour", baseUnit: "g" }];
    expect(CatalogueSchema.parse(list)).toEqual([{ ...list[0], ingredientCategory: "" }]);
  });
});

describe("prep schemas", () => {
  const session = { prepSessionId: "s1", userId: 7, prepDate: "2026-11-23", expectedCovers: 80, actualCovers: null, tasksTotal: 2, tasksCompleted: 1, tasksSkipped: 0, isEnded: false, createdDttm: "x", updatedDttm: "y", brandNew: 1 };
  const task = { prepTaskId: "t1", prepSessionId: "s1", taskDescription: "Prep Onion for Soup", ingredientName: "Onion", quantityNeeded: "4.500", unit: "kg", prepTimeMinutes: 20, priorityScore: 3, priorityTier: "start_first", station: "Veg", onHandQty: "1.000", prepNeeded: 3.5, status: "pending", assignedTo: null, completedAt: null, completedBy: null };

  it("reads today's session with numeric strings turned into numbers and unknown fields dropped", () => {
    const today = PrepTodaySchema.parse({ session, tasks: [task] });
    expect(today.session).toMatchObject({ prepSessionId: "s1", expectedCovers: 80, isEnded: false });
    expect(today.tasks[0]).toMatchObject({ quantityNeeded: 4.5, onHandQty: 1, prepNeeded: 3.5, station: "Veg", completedBy: null });
  });

  it("keeps a status or tier it does not know, and skips a task it cannot read", () => {
    const today = PrepTodaySchema.parse({ session, tasks: [{ ...task, status: "in_progress", priorityTier: "later" }, { nonsense: true }, { ...task, prepTaskId: "t3", status: 5 }] });
    expect(today.tasks.map((t) => [t.prepTaskId, t.status, t.priorityTier])).toEqual([["t1", "in_progress", "later"], ["t3", "pending", "start_first"]]);
  });

  it("needs a session", () => {
    expect(PrepTodaySchema.safeParse({ tasks: [] }).success).toBe(false);
  });

  it("reads the menu a cook can pick from, dropping rows without an id", () => {
    const menu = PrepMenuSchema.parse({ menuItems: [{ menuItemId: "m1", name: "Soup", category: "Starter", foodCostPct: 30 }, { name: "no id" }], recipes: [{ recipeId: "r1", title: "Stock", domain: "culinary" }], hasMenuItems: true });
    expect(menu).toEqual({ menuItems: [{ menuItemId: "m1", name: "Soup", category: "Starter" }], recipes: [{ recipeId: "r1", title: "Stock" }] });
  });

  it("reads the previous selections, which the server sends as a bare array", () => {
    expect(PrepSelectionsSchema.parse([{ selectionId: "x", menuItemId: "m1", recipeId: null, dishName: "Soup", expectedPortions: 12, category: "Starter" }, { nonsense: 1 }])).toEqual([{ menuItemId: "m1", recipeId: null, dishName: "Soup", expectedPortions: 12, category: "Starter" }]);
    expect(PrepSelectionsSchema.parse({ selections: [] })).toEqual([]);
  });
});

describe("consumption schemas", () => {
  const row = { consumptionLogId: "c1", ingredientId: "i1", ingredientName: "Gin", ingredientCategory: "Spirits", baseUnit: "L", quantity: "0.700", unit: "L", reason: "foh_operations", notes: null, shift: "evening", loggedAt: "2026-11-23T01:00:00.000Z", userId: 7, userName: "Rob", brandNew: 1 };

  it("reads an entry with its numeric string quantity and ignores what it does not know", () => {
    expect(ConsumptionEntrySchema.parse(row)).toMatchObject({ consumptionLogId: "c1", quantity: 0.7, unit: "L", reason: "foh_operations", userId: 7, userName: "Rob" });
    expect(ConsumptionEntrySchema.parse({ consumptionLogId: "c2", ingredientId: "i2", ingredientName: "Salt", quantity: 1, loggedAt: "2026-11-23T01:00:00.000Z" })).toMatchObject({ notes: null, shift: null, reason: "", userId: 0 });
  });

  it("skips a row it cannot read, never the whole list", () => {
    expect(ConsumptionListSchema.parse([row, { nonsense: true }, { ...row, consumptionLogId: "c3" }]).map((r) => r.consumptionLogId)).toEqual(["c1", "c3"]);
  });
});

describe("stock movement schemas", () => {
  it("reads the active areas and drops one with no name", () => {
    expect(StorageAreaListSchema.parse([{ storageAreaId: "a1", areaName: "Stock Room", sortOrder: 0, activeInd: true, itemCount: 4 }, { storageAreaId: "a2", areaName: "" }])).toEqual([{ storageAreaId: "a1", areaName: "Stock Room" }]);
  });

  it("reads a move by area names and skips a row that cannot be read", () => {
    const move = { stockMovementId: "m1", ingredientId: "i1", ingredientName: "Gin", quantity: "4.000", unit: "bottle", fromAreaName: "Stock Room", toAreaName: "Bar", userName: "Rob", notes: null, movedAt: "2026-11-23T01:00:00.000Z" };
    const list = StockMovementListSchema.parse([move, { nonsense: 1 }]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ quantity: 4, fromAreaName: "Stock Room", toAreaName: "Bar" });
  });
});

describe("conversation schemas", () => {
  it("lists conversations and drops a row without an id", () => {
    expect(ConversationListSchema.parse({ conversations: [{ conversationId: "c1", conversationTitle: "Hollandaise", updatedDttm: "2026-11-23T01:00:00Z", userId: 7 }, { conversationTitle: "no id" }] })).toEqual([
      { conversationId: "c1", conversationTitle: "Hollandaise", updatedDttm: "2026-11-23T01:00:00Z" },
    ]);
  });

  it("orders messages by sequence and drops a role the phone does not know", () => {
    const detail = ConversationDetailSchema.parse({
      conversation: {
        conversationId: "c1",
        conversationTitle: "Fish",
        messages: [
          { messageId: "m2", messageRole: "assistant", messageBody: "Pat it dry.", messageSequence: 1 },
          { messageId: "m0", messageRole: "system", messageBody: "x", messageSequence: 2 },
          { messageId: "m1", messageRole: "user", messageBody: "Crisp skin?", messageSequence: 0 },
        ],
      },
    });
    expect(detail.messages.map((m) => m.messageId)).toEqual(["m1", "m2"]);
  });
});

describe("recipe schemas", () => {
  const data = { name: "Braise", description: "Slow", yield: "4", prepTime: "10 min", cookTime: "2 h", difficulty: "intermediate", ingredients: [{ amount: 2, unit: "kg", name: "Chicken thigh" }, { unit: "g" }], steps: [{ step: 1, instruction: "Brown." }], allergenNote: "None", confidenceNote: "High", flavorBalance: { sweet: { score: 3 } } };

  it("reads what the recipe screen shows, tolerating a numeric amount and a broken row", () => {
    const parsed = parseRecipeData(data);
    expect(parsed.ingredients).toEqual([{ amount: "2", unit: "kg", name: "Chicken thigh", note: undefined }]);
    expect(parsed.proTips).toEqual([]);
    expect(parseRecipeData(null).name).toBe("");
  });

  it("keeps recipeData exactly as sent, so a refinement can be accepted with it", () => {
    const recipe = RecipeSchema.parse({ recipeId: "r1", title: "Braise", recipeData: data, isPublicInd: true, kitchenContext: "x" });
    expect(recipe.recipeData).toBe(data);
    expect(recipe.userId).toBeUndefined();
  });

  it("reads a page of my recipes", () => {
    expect(RecipePageSchema.parse({ recipes: [{ recipeId: "r1", title: "Braise", isPublicInd: "yes" }], total: 1, page: 1, limit: 20 }).recipes[0]).toMatchObject({ recipeId: "r1", isPublicInd: false, slug: null });
  });

  it("tells a saved recipe from a prose answer", () => {
    expect("recipe" in GenerateReplySchema.parse({ recipe: data, recipeId: "r1", imageUrl: null, slug: "braise" })).toBe(true);
    // The server sends `{ memoryId, title, sourceType }` per note; a title can be null.
    expect(GenerateReplySchema.parse({ recipe: data, recipeId: "r1", brainGrounded: [{ memoryId: "m1", title: "Fish supplier", sourceType: "note" }, { memoryId: "m2", title: null }, "junk"] })).toMatchObject({ brainGrounded: [{ title: "Fish supplier" }, { title: null }] });
    expect(GenerateReplySchema.parse({ prose: "Try a stew." })).toEqual({ prose: "Try a stew." });
    expect(GenerateReplySchema.safeParse({}).success).toBe(false);
  });

  it("needs an object to accept from a refinement", () => {
    expect(RefineReplySchema.safeParse({ refinedData: data, changeSummary: "Dairy-free" }).success).toBe(true);
    expect(RefineReplySchema.safeParse({ refinedData: null, changeSummary: "" }).success).toBe(false);
  });
});

describe("notification and profile schemas", () => {
  it("keeps the readable notifications and leaves out a row this app cannot read", () => {
    const good = { notificationId: "n1", organisationId: 1, recipientUserId: 7, type: "SHIFT_ASSIGNED", channel: "IN_APP", status: "SENT", payload: { body: "x" }, relatedEntityType: "shift", relatedEntityId: "s1", sentAt: null, readAt: null, createdAt: "2026-11-24T10:00:00Z" };
    const rows = AppNotificationListSchema.parse([good, { type: "NO_ID" }, { ...good, notificationId: "n2", payload: null, relatedEntityType: undefined }]);
    expect(rows.map((r) => r.notificationId)).toEqual(["n1", "n2"]);
    expect(rows[1]).toMatchObject({ payload: {}, relatedEntityType: null });
    expect(UnreadCountSchema.parse({ count: "lots" }).count).toBe(0);
  });

  it("reads profile details with every empty field as blank, and a kitchen profile never saved as the defaults", () => {
    const { profile } = ProfileDetailsReplySchema.parse({ profile: { userName: "Chef", userBio: null, userEmail: "c@x.test", userPhotoPath: null, userPasswordHash: "never-read" } });
    expect(profile).toMatchObject({ userName: "Chef", userBio: "", userLinkedin: "", userPhotoPath: null });
    expect(profile).not.toHaveProperty("userPasswordHash");
    expect(KitchenProfileSchema.parse({ pricePoint: null })).toMatchObject({ skillLevel: "home_cook", servingsDefault: 4, pricePoint: "" });
    expect(MfaSetupReplySchema.parse({ secret: "S" })).toEqual({ secret: "S", qrCodeDataUrl: "" });
    expect(PersonalisationOptionsSchema.parse({ skill_level: "broken" }).skill_level).toEqual([]);
  });
});

describe("purchase order schemas", () => {
  const id = "6f1c2a9e-0b7d-4c55-9b0e-2f6a1d3c4b5a";
  const line = { ingredientId: id, orderedQty: "2", orderedUnit: "kg", unitCost: "0" };
  const input = { storeLocationId: id, supplierId: id, lines: [line] };

  it("takes the body older web versions send, and leaves the id to create", () => {
    expect(CreatePurchaseOrderSchema.parse({ ...input, notes: "x", expectedDeliveryDate: "2026-12-01" })).not.toHaveProperty("poId");
    expect(CreatePurchaseOrderSchema.parse({ ...input, poId: id }).poId).toBe(id);
    expect(PurchaseOrderInputSchema.parse({ ...input, poId: id })).not.toHaveProperty("poId");
    expect(PurchaseOrderInputSchema.safeParse({ ...input, expectedDeliveryDate: "" }).success).toBe(true);
  });

  it.each([
    [{ lines: [] }],
    [{ lines: [{ ...line, orderedQty: "0" }] }],
    [{ lines: [{ ...line, orderedQty: "Infinity" }] }],
    [{ lines: [{ ...line, unitCost: " " }] }],
    [{ lines: [{ ...line, unitCost: "-1" }] }],
    [{ expectedDeliveryDate: "soon" }],
    [{ poId: "po-1" }],
  ])("refuses %j", (over) => {
    expect(CreatePurchaseOrderSchema.safeParse({ ...input, ...over }).success).toBe(false);
  });

  it("reads the order the server answers, tolerating a field it does not know or a missing one", () => {
    const po = PurchaseOrderSchema.parse({ poId: "p1", status: "NEW_STATUS", storeLocationId: "l1", supplierId: "s1", totalValue: null, lines: [{ lineId: "x", ingredientId: "i1", orderedQty: "7.50", orderedUnit: "kg", unitCost: null, lineStatus: "PENDING" }] });
    expect(po).toMatchObject({ poNumber: "", status: "NEW_STATUS", notes: null, expectedDeliveryDate: null, lines: [{ orderedQty: 7.5, unitCost: null }] });
  });
});

describe("catalogue request list schema", () => {
  const row = {
    requestId: "r1", storeLocationId: "loc-1", itemName: "Sumac", itemType: "KITCHEN_INGREDIENT", category: null, baseUnit: null, countedQty: "2.500",
    status: "REJECTED", reviewNotes: "We stock it", createdIngredientId: null, createdDttm: "2026-11-20T00:00:00.000Z", updatedDttm: "2026-11-21T00:00:00.000Z",
  };

  it("reads a row, with the counted quantity as a number and HQ's notes", () => {
    expect(CatalogRequestListSchema.parse({ data: [row], total: 1 }).data[0]).toMatchObject({ countedQty: 2.5, status: "REJECTED", reviewNotes: "We stock it" });
  });

  it("keeps a status it does not know, and one bad row does not hide the others", () => {
    const list = CatalogRequestListSchema.parse({ data: [{ ...row, status: "MERGED" }, { nonsense: true }, { ...row, requestId: "r2", countedQty: null }], total: 3 });
    expect(list.data.map((r) => [r.requestId, r.status, r.countedQty])).toEqual([["r1", "MERGED", 2.5], ["r2", "REJECTED", null]]);
  });
});

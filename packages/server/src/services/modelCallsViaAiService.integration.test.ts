import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { menuItem, user, wasteLog } from "../db/schema.js";
import { AppError } from "../utils/appError.js";

/** The model, as aiService reaches it. The two services must go through this and nowhere else. */
const generateStructured = vi.fn();
vi.mock("./aiService.js", async (orig) => ({ ...(await orig<object>()), generateStructured: (a: unknown) => generateStructured(a) }));
vi.mock("ai", async () => ({
  ...(await vi.importActual<typeof import("ai")>("ai")),
  generateObject: () => {
    throw new Error("a service called the model directly instead of through aiService");
  },
}));

const { getItemRecommendations, createMenuItem } = await import("./menuIntelligenceService.js");
const { generateReuseSuggestions } = await import("./wasteService.js");

/**
 * Menu recommendations and waste reuse suggestions call the model through aiService, and when it fails
 * the caller gets a real error, not a canned answer that looks like success. Gated on TENANT_IT=1. Self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

const tag = `mc_${Date.now().toString(36)}`;
let uid: number;
let itemId: string;
/** These users belong to no organisation, so each reads only their own menu items. */
const scope = (userId: number) => ({ userId, organisationId: null, isOrgAdmin: false });

describe.skipIf(!RUN)("model calls go through aiService (real DB)", () => {
  beforeAll(async () => {
    [{ id: uid }] = await db.insert(user).values({ userName: tag, userEmail: `${tag}@it.test` }).returning({ id: user.userId });
    const item = await createMenuItem(scope(uid), { name: `${tag} risotto`, category: "mains", sellingPrice: "24" } as Parameters<typeof createMenuItem>[1]);
    itemId = item.menuItemId;
    await db.insert(wasteLog).values({ userId: uid, ingredientName: `${tag} rice`, quantity: "2", unit: "kg", reason: "spoilage" });
  });
  afterAll(async () => {
    await db.delete(wasteLog).where(inArray(wasteLog.userId, [uid]));
    await db.delete(menuItem).where(inArray(menuItem.userId, [uid]));
    await db.delete(user).where(inArray(user.userId, [uid]));
  });

  describe("getItemRecommendations", () => {
    it("returns the model's recommendations, asking for them with the item's own details", async () => {
      const wanted = { summary: "Protect it.", actions: [{ type: "protect", description: "Keep it." }] };
      generateStructured.mockResolvedValueOnce(wanted);

      expect(await getItemRecommendations(itemId, scope(uid))).toEqual(wanted);
      expect(generateStructured.mock.calls[0][0].prompt).toContain(`${tag} risotto`);
    });

    it("when the model fails the caller gets the 503, not a canned recommendation", async () => {
      generateStructured.mockRejectedValueOnce(new AppError(503, "AI_UNAVAILABLE", "down"));
      await expect(getItemRecommendations(itemId, scope(uid))).rejects.toMatchObject({ statusCode: 503, code: "AI_UNAVAILABLE" });
    });

    it("an item that is not yours is a 404 NOT_FOUND", async () => {
      await expect(getItemRecommendations(itemId, scope(uid + 1_000_000))).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
    });
  });

  describe("generateReuseSuggestions", () => {
    it("turns the model's suggestions into rows with ids", async () => {
      generateStructured.mockResolvedValueOnce({
        suggestions: [{ ingredientName: `${tag} rice`, quantityWasted: 2, suggestion: "Arancini", type: "special" }],
      });

      const out = await generateReuseSuggestions(uid);

      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ ingredientName: `${tag} rice`, suggestion: "Arancini", type: "special" });
      expect(out[0].id).toEqual(expect.any(String));
    });

    it("when the model fails the caller gets the 504 or 503 as it was, not a generic 500", async () => {
      generateStructured.mockRejectedValueOnce(new AppError(504, "AI_TIMEOUT", "slow"));
      await expect(generateReuseSuggestions(uid)).rejects.toMatchObject({ statusCode: 504, code: "AI_TIMEOUT" });
    });
  });
});

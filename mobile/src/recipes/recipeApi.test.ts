import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { createRecipeApi } from "./recipeApi";

const summary = (recipeId: string, imageUrl: string | null) => ({ recipeId, slug: null, title: recipeId, description: null, domain: "recipe", imageUrl, isPublicInd: false, createdDttm: "" });

describe("recipe api", () => {
  // The server stores `/uploads/generated/<file>` when it keeps a generated image itself (no Cloudinary); a browser resolves that against the site, a phone cannot.
  it("gives an image the server keeps itself its whole address, in the list and on the recipe", async () => {
    const request = vi.fn();
    const api = createRecipeApi({ baseUrl: "https://kitchen.test", request } as unknown as ApiClient);
    request.mockResolvedValueOnce({ recipes: [summary("a", "/uploads/generated/a.png"), summary("b", "https://res.cloudinary.com/x/b.png"), summary("c", null)], total: 3, page: 1 });
    expect((await api.mine(1)).recipes.map((r) => r.imageUrl)).toEqual(["https://kitchen.test/uploads/generated/a.png", "https://res.cloudinary.com/x/b.png", null]);
    request.mockResolvedValueOnce({ ...summary("a", "/uploads/generated/a.png"), recipeData: {} });
    expect((await api.get("a")).imageUrl).toBe("https://kitchen.test/uploads/generated/a.png");
  });
});

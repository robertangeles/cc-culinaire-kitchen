import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The server refuses PATCH /api/recipes/:id for every guest (403 FORBIDDEN), so the Recipe Lab must not
 * offer a guest the public/private control; a signed-in user keeps it.
 */

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext.js", () => ({ useAuth: () => mockUseAuth() }));
// Stubbed so the card renders without its own network calls.
vi.mock("../components/recipes/RecipeRatings.js", () => ({ default: () => null }));
vi.mock("../components/recipes/RecipeShareBar.js", () => ({ RecipeShareBar: () => null }));

const { RecipeLabPage } = await import("./RecipeLabPage.js");

const generated = {
  recipe: {
    name: "Charred Leeks",
    description: "Leeks, charred.",
    yield: "4",
    prepTime: "10 min",
    cookTime: "20 min",
    difficulty: "beginner",
    ingredients: [{ amount: "4", unit: "", name: "leeks" }],
    steps: [{ step: 1, instruction: "Char the leeks." }],
    allergenNote: "",
    confidenceNote: "",
  },
  imageUrl: null,
  recipeId: "11111111-1111-4111-8111-111111111111",
  slug: "charred-leeks",
};
const auth = { refreshGuestUsage: vi.fn(), refreshUser: vi.fn() };
const toggle = () => screen.queryByRole("button", { name: /make public/i });

describe("RecipeLabPage — public/private control", () => {
  beforeEach(() => sessionStorage.clear());

  it("is not offered to a guest", () => {
    sessionStorage.setItem("recipe_lab_recipe_guest-token", JSON.stringify(generated));
    mockUseAuth.mockReturnValue({ ...auth, user: null, isGuest: true, guestToken: "guest-token" });
    render(<RecipeLabPage domain="recipe" />);

    expect(screen.getAllByText("Charred Leeks").length).toBeGreaterThan(0);
    expect(toggle()).not.toBeInTheDocument();
  });

  it("is offered to a signed-in user", () => {
    sessionStorage.setItem("recipe_lab_recipe_7", JSON.stringify(generated));
    mockUseAuth.mockReturnValue({ ...auth, user: { userId: 7, userName: "Chef", userPhotoPath: null }, isGuest: false, guestToken: null });
    render(<RecipeLabPage domain="recipe" />);

    expect(toggle()).toBeInTheDocument();
  });
});

describe("RecipeLabPage — a new image that fails", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("shows the server's message when image generation answers 503 AI_UNAVAILABLE", async () => {
    const message = "The AI service could not complete that. Please try again.";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: message, code: "AI_UNAVAILABLE" }) }));
    sessionStorage.setItem("recipe_lab_recipe_7", JSON.stringify(generated));
    mockUseAuth.mockReturnValue({ ...auth, user: { userId: 7, userName: "Chef", userPhotoPath: null }, isGuest: false, guestToken: null });
    render(<RecipeLabPage domain="recipe" />);

    fireEvent.click(screen.getByRole("button", { name: /new image/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RecipeEditor } from "./RecipeEditor.js";

/**
 * POST /api/recipes/:id/regenerate-image answers 503 AI_UNAVAILABLE or 504 AI_TIMEOUT when the image cannot be
 * made. The editor's "New Image" button has to say so, not just stop its spinner.
 */

const recipeData = {
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
};

const fetchMock = vi.fn();
const onImageUpdate = vi.fn();

function askForImage() {
  fireEvent.click(screen.getByRole("button", { name: /new image/i }));
}

describe("RecipeEditor — New Image", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    onImageUpdate.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    render(<RecipeEditor recipeData={recipeData} recipeId="r1" onSave={vi.fn()} onCancel={vi.fn()} onOpenRefine={vi.fn()} onImageUpdate={onImageUpdate} />);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the server's message when the answer is 503 AI_UNAVAILABLE", async () => {
    const message = "The AI service could not complete that. Please try again.";
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: message, code: "AI_UNAVAILABLE" }) });
    askForImage();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(onImageUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["the answer is an error page, not JSON", () => fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError("not json"); } })],
    ["the network is down", () => fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))],
  ])("says the image could not be made when %s", async (_name, arrange) => {
    arrange();
    askForImage();

    expect(await screen.findByRole("alert")).toHaveTextContent("The image could not be made. Please try again.");
  });

  it("clears the message and hands over the new image when the next try works", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "x" }) });
    askForImage();
    await screen.findByRole("alert");

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ imageUrl: "/uploads/new.png" }) });
    askForImage();

    await waitFor(() => expect(onImageUpdate).toHaveBeenCalledWith("/uploads/new.png"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

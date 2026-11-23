import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const handleChatStream = vi.fn();
const handleImageGeneration = vi.fn();
const chargeSession = vi.fn();
vi.mock("../controllers/chatController.js", () => ({ handleChatStream, handleImageGeneration }));
vi.mock("../middleware/usage.js", () => ({ checkSessionQuota: vi.fn(), chargeSession }));
vi.mock("../middleware/guestAuth.js", () => ({ authenticateOrGuest: vi.fn() }));

const { chatRouter } = await import("./chat.js");

/** The route's own handler, the last one wired on it. */
function handlerOf(path: string) {
  const layer = chatRouter.stack.find((l) => l.route?.path === path && (l.route as { methods: Record<string, boolean> }).methods.post);
  const stack = layer!.route!.stack;
  return stack[stack.length - 1].handle as (req: Request, res: Response, next: (e?: unknown) => void) => Promise<void>;
}
const run = (path: string) => handlerOf(path)({ user: { sub: 1 } } as Request, {} as Response, vi.fn());

describe.each([
  ["/", handleChatStream],
  ["/image", handleImageGeneration],
])("POST %s charges a session only for an answer that arrived", (path, controller) => {
  beforeEach(() => vi.clearAllMocks());

  it("charges once when the controller says it worked", async () => {
    controller.mockResolvedValue(true);
    await run(path);
    expect(chargeSession).toHaveBeenCalledOnce();
  });

  it("does not charge when the controller refused or failed (a 400, a model error, a client that left)", async () => {
    controller.mockResolvedValue(false);
    await run(path);
    expect(chargeSession).not.toHaveBeenCalled();
  });

  it("does not charge when the controller throws", async () => {
    controller.mockRejectedValue(new Error("boom"));
    await expect(run(path)).rejects.toThrow("boom");
    expect(chargeSession).not.toHaveBeenCalled();
  });
});

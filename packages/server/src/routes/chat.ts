import { Router } from "express";
import { ChatRequestSchema } from "@culinaire/shared";

export const chatRouter = Router();

chatRouter.post("/", async (req, res) => {
  const parsed = ChatRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  // Placeholder — will be wired to aiService
  res.json({
    response: "Chat service is not yet implemented.",
    conversationId: parsed.data.conversationId ?? "placeholder",
    sources: [],
  });
});

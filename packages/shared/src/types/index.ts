import { z } from "zod";

// Message roles
export const MessageRole = z.enum(["user", "assistant"]);
export type MessageRole = z.infer<typeof MessageRole>;

// Chat message
export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: MessageRole,
  content: z.string(),
  timestamp: z.string().datetime(),
});
export type Message = z.infer<typeof MessageSchema>;

// Chat request
export const ChatRequestSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// Chat response
export const ChatResponseSchema = z.object({
  response: z.string(),
  conversationId: z.string(),
  sources: z.array(z.string()),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

// Health check
export interface HealthResponse {
  status: "ok";
  timestamp: string;
}

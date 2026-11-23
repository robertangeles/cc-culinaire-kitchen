import { z } from "zod";

/** A saved chat as `GET /api/conversations` lists it (newest first, no pagination). */
export const ConversationSummarySchema = z.object({
  conversationId: z.string(),
  conversationTitle: z.string().catch("Conversation"),
  updatedDttm: z.string().catch(""),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
export const ConversationListSchema = z
  .object({ conversations: z.array(z.unknown()).catch([]) })
  .transform(({ conversations }) => conversations.flatMap((r) => { const p = ConversationSummarySchema.safeParse(r); return p.success ? [p.data] : []; }));

/** One saved message; a role this app does not know is dropped. */
export const ConversationMessageSchema = z.object({
  messageId: z.string(),
  messageRole: z.enum(["user", "assistant"]),
  messageBody: z.string().catch(""),
  messageSequence: z.number().catch(0),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

/** `GET /api/conversations/:id`: the chat with its messages in order. */
export const ConversationDetailSchema = z
  .object({
    conversation: z.object({
      conversationId: z.string(),
      conversationTitle: z.string().catch("Conversation"),
      messages: z.array(z.unknown()).catch([]),
    }),
  })
  .transform(({ conversation }) => ({
    conversationId: conversation.conversationId,
    conversationTitle: conversation.conversationTitle,
    messages: conversation.messages
      .flatMap((r) => { const p = ConversationMessageSchema.safeParse(r); return p.success ? [p.data] : []; })
      .sort((a, b) => a.messageSequence - b.messageSequence),
  }));
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

import { ConversationDetailSchema, ConversationListSchema, type ConversationDetail, type ConversationSummary } from "@culinaire/shared/schemas/conversation";
import type { ApiClient } from "../api/client";
import { readDataStream, type StreamEvent } from "./dataStream";

export interface WireMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SavedMessage {
  messageId: string;
  messageRole: "user" | "assistant";
  messageBody: string;
  messageSequence: number;
}

/** The server gives up on an answer after 3 minutes and says so in the stream; wait a little longer for the first byte than that. */
const FIRST_BYTE_MS = 190_000;

/** Chat and saved conversations. The server keeps no chat state: every turn sends the whole history. */
export function createChatApi(client: ApiClient) {
  const one = (id: string) => `/api/conversations/${encodeURIComponent(id)}`;
  return {
    list(): Promise<ConversationSummary[]> {
      return client.request("GET", "/api/conversations", { schema: ConversationListSchema });
    },
    get(id: string): Promise<ConversationDetail> {
      return client.request("GET", one(id), { schema: ConversationDetailSchema });
    },
    /** Safe to repeat: the same id by the same person answers 200. */
    async create(id: string, title: string): Promise<void> {
      await client.request("POST", "/api/conversations", { body: { id, title } });
    },
    /** Safe to repeat: ids the server already has are skipped. */
    async save(id: string, messages: SavedMessage[]): Promise<void> {
      await client.request("POST", `${one(id)}/messages`, { body: { messages } });
    },
    async remove(id: string): Promise<void> {
      await client.request("DELETE", one(id));
    },
    /** The answer to the history, part by part as it arrives. Stop it with `signal`. */
    answer(messages: WireMessage[], signal: AbortSignal): AsyncGenerator<StreamEvent> {
      return readDataStream(client.stream("POST", "/api/chat", { body: { messages }, signal, timeoutMs: FIRST_BYTE_MS }));
    },
  };
}

export type ChatApi = ReturnType<typeof createChatApi>;

/**
 * @module ConversationContext
 *
 * React context that lifts conversation list state from the
 * `useConversations` hook into a shared provider. This allows both the
 * sidebar (ConversationList) and the chat area (ChatContainer) to read
 * and mutate the same conversation list without prop drilling.
 */

import { createContext, useContext, type ReactNode } from "react";
import {
  useConversations,
  type Conversation,
} from "../hooks/useConversations.js";

/** Public shape exposed by the conversation context. */
interface ConversationContextType {
  /** List of conversations ordered by most recently updated. */
  conversations: Conversation[];
  /** True while the conversation list is being fetched. */
  isLoading: boolean;
  /** Refresh the conversation list from the server. */
  refresh: () => Promise<void>;
  /** Create a new conversation and refresh the list. */
  create: (id: string, title: string) => Promise<void>;
  /** Delete a conversation and refresh the list. */
  remove: (id: string) => Promise<void>;
}

const ConversationContext = createContext<ConversationContextType | null>(null);

/**
 * Provides conversation state to the component tree.
 * Must wrap any component that calls {@link useConversationContext}.
 */
export function ConversationProvider({ children }: { children: ReactNode }) {
  const convState = useConversations();
  return (
    <ConversationContext.Provider value={convState}>
      {children}
    </ConversationContext.Provider>
  );
}

/**
 * Consume the shared conversation state.
 *
 * @throws If called outside a {@link ConversationProvider}.
 */
export function useConversationContext(): ConversationContextType {
  const ctx = useContext(ConversationContext);
  if (!ctx) {
    throw new Error(
      "useConversationContext must be used within a ConversationProvider"
    );
  }
  return ctx;
}

/**
 * @module useConversations
 *
 * Custom hook for listing, creating, and deleting chat conversations
 * via the `/api/conversations` REST endpoints.
 * Supports both authenticated users (via cookies) and guest sessions
 * (via X-Guest-Token header).
 */

import { useState, useEffect, useCallback } from "react";

const GUEST_TOKEN_KEY = "culinaire_guest_token";

/** Build headers with guest token if present. */
function getGuestHeaders(): Record<string, string> {
  const token = localStorage.getItem(GUEST_TOKEN_KEY);
  return token ? { "X-Guest-Token": token } : {};
}

/** Conversation metadata returned by the list endpoint. */
export interface Conversation {
  conversationId: string;
  conversationTitle: string;
  createdDttm: string;
  updatedDttm: string;
}

/** Shape returned by the {@link useConversations} hook. */
interface UseConversationsReturn {
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

/**
 * Manages the conversation list: fetch on mount, create, and delete.
 *
 * @returns Conversation state and actions — see {@link UseConversationsReturn}.
 */
export function useConversations(): UseConversationsReturn {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations", {
        headers: getGuestHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations);
    } catch {
      // Silently fail — conversation list is non-critical
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (id: string, title: string) => {
      try {
        await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getGuestHeaders() },
          body: JSON.stringify({ id, title }),
        });
        await refresh();
      } catch {
        // Silently fail
      }
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/conversations/${id}`, {
          method: "DELETE",
          headers: getGuestHeaders(),
        });
        await refresh();
      } catch {
        // Silently fail
      }
    },
    [refresh]
  );

  return { conversations, isLoading, refresh, create, remove };
}

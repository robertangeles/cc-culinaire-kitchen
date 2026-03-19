/**
 * @module ChatPage
 *
 * Page component for the chat interface. Reads the conversation ID from
 * the URL params and loads an existing conversation or starts a new one.
 * Passes the conversation context down to {@link ChatContainer}.
 */

import { useParams, Navigate, useLocation } from "react-router";
import { useEffect, useState } from "react";
import { ChatContainer } from "../components/chat/ChatContainer.js";
import type { UIMessage } from "ai";
import { useChatStream } from "../context/ChatStreamContext.js";
import { useAuth } from "../context/AuthContext.js";

const GUEST_TOKEN_KEY = "culinaire_guest_token";

/** Message shape returned by the conversations API. */
interface ApiMessage {
  messageId: string;
  messageRole: string;
  messageBody: string;
  messageSequence: number;
}

/**
 * Renders the chat page. For existing conversations (`:id` param),
 * fetches messages from the API and passes them as `initialMessages`.
 * For new chats (`/chat/new`), renders an empty ChatContainer.
 */
export function ChatPage() {
  const { id } = useParams();
  const location = useLocation();
  const isNew = !id || id === "new";
  const { claimStream, hasBackgroundStream } = useChatStream();
  const { isAuthenticated, isGuest } = useAuth();

  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(
    isNew ? [] : null
  );
  const [error, setError] = useState(false);

  useEffect(() => {
    if (isNew) {
      setInitialMessages([]);
      return;
    }

    // Check for optimistic preload sources (router state from navigate, or
    // background stream). Show these IMMEDIATELY to avoid white flash, then
    // verify ownership in background. If verification fails → redirect.
    let cancelled = false;

    const navMessages = (location.state as { initialMessages?: UIMessage[] } | null)
      ?.initialMessages;
    let hasOptimistic = false;

    if (navMessages && navMessages.length > 0) {
      // Show immediately — came from our own ChatContainer navigate
      setInitialMessages(navMessages);
      hasOptimistic = true;
    } else if (id && hasBackgroundStream(id)) {
      const stream = claimStream(id);
      if (stream && stream.messages.length > 0) {
        setInitialMessages(stream.messages);
        hasOptimistic = true;
      }
    }

    // SECURITY: Always verify conversation ownership via API.
    // If we have optimistic messages, verification runs in background.
    // If not, show loading state while we fetch.
    async function verifyAndLoad() {
      try {
        const guestToken = localStorage.getItem(GUEST_TOKEN_KEY);
        const headers: Record<string, string> = guestToken ? { "X-Guest-Token": guestToken } : {};
        const res = await fetch(`/api/conversations/${id}`, {
          headers,
          credentials: "include",
        });
        if (!res.ok) throw new Error("Not found");
        const data = await res.json();
        if (cancelled) return;

        const msgs: UIMessage[] = data.conversation.messages.map(
          (m: ApiMessage) => ({
            id: m.messageId,
            role: m.messageRole as "user" | "assistant",
            content: m.messageBody,
            parts: [{ type: "text" as const, text: m.messageBody }],
          })
        );

        if (msgs.length === 0) {
          if (!cancelled) setError(true);
        } else if (!hasOptimistic) {
          // No optimistic data — use API response
          if (!cancelled) setInitialMessages(msgs);
        }
        // If we had optimistic data, keep it (it's fresher from the stream)
      } catch {
        if (!cancelled) setError(true);
      }
    }

    if (!hasOptimistic) {
      // No optimistic data — show loading state
      setInitialMessages(null);
    }
    setError(false);
    verifyAndLoad();

    return () => {
      cancelled = true;
    };
  }, [id, isNew, claimStream, hasBackgroundStream, location.state]);

  if (error) {
    return <Navigate to="/chat/new" replace />;
  }

  const isLoadingHistory = initialMessages === null && !isNew;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#0A0A0A]">
      <ChatContainer
        key={isLoadingHistory ? `${id}-loading` : (id ?? "new")}
        conversationId={isNew ? undefined : id}
        initialMessages={initialMessages ?? []}
        isLoadingHistory={isLoadingHistory}
      />
    </div>
  );
}

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

  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(
    isNew ? [] : null
  );
  const [error, setError] = useState(false);

  useEffect(() => {
    if (isNew) {
      setInitialMessages([]);
      return;
    }

    // If we just navigated here from /chat/new with messages in router state,
    // use them directly — avoids the API round-trip and loading flash.
    const navMessages = (location.state as { initialMessages?: UIMessage[] } | null)
      ?.initialMessages;
    if (navMessages && navMessages.length > 0) {
      setInitialMessages(navMessages);
      return;
    }

    // Check for a completed background stream first
    if (id && hasBackgroundStream(id)) {
      const stream = claimStream(id);
      if (stream && stream.messages.length > 0) {
        setInitialMessages(stream.messages);
        return;
      }
    }

    let cancelled = false;

    async function loadConversation() {
      try {
        const guestToken = localStorage.getItem(GUEST_TOKEN_KEY);
        const headers: Record<string, string> = guestToken ? { "X-Guest-Token": guestToken } : {};
        const res = await fetch(`/api/conversations/${id}`, { headers });
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
        // Treat an empty conversation (orphaned from a failed stream) as not found.
        // This redirects the user to /chat/new instead of showing a blank chat.
        if (msgs.length === 0) {
          if (!cancelled) setError(true);
        } else {
          if (!cancelled) setInitialMessages(msgs);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    setInitialMessages(null);
    setError(false);
    loadConversation();

    return () => {
      cancelled = true;
    };
  }, [id, isNew, claimStream, hasBackgroundStream, location.state]);

  if (error) {
    return <Navigate to="/chat/new" replace />;
  }

  const isLoadingHistory = initialMessages === null && !isNew;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <ChatContainer
        key={isLoadingHistory ? `${id}-loading` : (id ?? "new")}
        conversationId={isNew ? undefined : id}
        initialMessages={initialMessages ?? []}
        isLoadingHistory={isLoadingHistory}
      />
    </div>
  );
}

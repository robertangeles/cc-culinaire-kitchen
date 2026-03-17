/**
 * @module hooks/useBenchMessages
 *
 * Message state management for a Bench channel.
 * Initial load via REST, real-time updates via Socket.io.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useBenchSocket } from "../context/BenchSocketContext.js";

export interface BenchMessage {
  messageId: string;
  channelId: number;
  userId: number;
  userName: string;
  userPhotoPath: string | null;
  messageBody: string;
  messageType: string;
  recipeId: string | null;
  recipeTitle?: string | null;
  recipeImageUrl?: string | null;
  recipeSlug?: string | null;
  editedInd: boolean;
  deletedInd: boolean;
  createdDttm: string;
  reactions: { emoji: string; count: number; userIds: number[] }[];
}

const API = import.meta.env.VITE_API_URL ?? "";

export function useBenchMessages(channelKey: string) {
  const { socket } = useBenchSocket();
  const [messages, setMessages] = useState<BenchMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const joinedRef = useRef(false);

  // Initial fetch via REST
  const fetchMessages = useCallback(async (before?: string) => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (before) params.set("before", before);
      const res = await fetch(`${API}/api/bench/channels/${channelKey}/messages?${params}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      const msgs = data.messages as BenchMessage[];

      if (before) {
        // Prepend older messages
        setMessages((prev) => [...msgs, ...prev]);
      } else {
        setMessages(msgs);
      }
      setHasMore(msgs.length >= 50);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [channelKey]);

  // Load initial messages and join socket room
  useEffect(() => {
    setMessages([]);
    setLoading(true);
    setHasMore(true);
    joinedRef.current = false;
    fetchMessages();

    if (socket?.connected) {
      socket.emit("bench:join", { channelKey });
      joinedRef.current = true;
    }

    return () => {
      if (socket?.connected && joinedRef.current) {
        socket.emit("bench:leave", { channelKey });
      }
    };
  }, [channelKey, socket, fetchMessages]);

  // Join room when socket connects (reconnection)
  useEffect(() => {
    if (!socket) return;
    function onConnect() {
      socket!.emit("bench:join", { channelKey });
      joinedRef.current = true;
      // Re-fetch to catch missed messages
      fetchMessages();
    }
    socket.on("connect", onConnect);
    return () => { socket.off("connect", onConnect); };
  }, [socket, channelKey, fetchMessages]);

  // Listen for real-time messages
  useEffect(() => {
    if (!socket) return;

    function onNewMessage(msg: BenchMessage) {
      // Only add if it belongs to our channel
      setMessages((prev) => {
        if (prev.some((m) => m.messageId === msg.messageId)) return prev;
        return [...prev, msg];
      });
    }

    function onDeletedMessage({ messageId }: { messageId: string }) {
      setMessages((prev) => prev.filter((m) => m.messageId !== messageId));
    }

    function onReactionUpdated({ messageId, reactions }: { messageId: string; reactions: BenchMessage["reactions"] }) {
      setMessages((prev) =>
        prev.map((m) => m.messageId === messageId ? { ...m, reactions } : m),
      );
    }

    function onEditedMessage({ messageId, newBody, editedInd }: { messageId: string; newBody: string; editedInd: boolean }) {
      setMessages((prev) =>
        prev.map((m) => m.messageId === messageId ? { ...m, messageBody: newBody, editedInd } : m),
      );
    }

    socket.on("bench:message:new", onNewMessage);
    socket.on("bench:message:deleted", onDeletedMessage);
    socket.on("bench:reaction:updated", onReactionUpdated);
    socket.on("bench:message:edited", onEditedMessage);

    return () => {
      socket.off("bench:message:new", onNewMessage);
      socket.off("bench:message:deleted", onDeletedMessage);
      socket.off("bench:reaction:updated", onReactionUpdated);
      socket.off("bench:message:edited", onEditedMessage);
    };
  }, [socket]);

  const sendMessage = useCallback(
    (body: string, messageType?: string, recipeId?: string) => {
      if (!socket?.connected) return;
      socket.emit("bench:message", { channelKey, body, messageType, recipeId });
    },
    [socket, channelKey],
  );

  const deleteMessage = useCallback(
    (messageId: string) => {
      if (!socket?.connected) return;
      socket.emit("bench:message:delete", { messageId, channelKey });
    },
    [socket, channelKey],
  );

  const editMessage = useCallback(
    (messageId: string, newBody: string) => {
      if (!socket?.connected) return;
      socket.emit("bench:message:edit", { messageId, channelKey, newBody });
    },
    [socket, channelKey],
  );

  const loadMore = useCallback(() => {
    if (messages.length === 0 || !hasMore) return;
    const oldest = messages[0];
    fetchMessages(oldest.createdDttm);
  }, [messages, hasMore, fetchMessages]);

  return { messages, loading, hasMore, loadMore, sendMessage, deleteMessage, editMessage };
}

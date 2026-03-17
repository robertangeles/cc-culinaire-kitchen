/**
 * @module hooks/useBenchDm
 *
 * Direct message state management for The Bench.
 */

import { useState, useEffect, useCallback } from "react";
import { useBenchSocket } from "../context/BenchSocketContext.js";

export interface DmThread {
  dmThreadId: number;
  otherUserId: number;
  otherUserName: string;
  otherUserPhotoPath: string | null;
  lastMessage: string | null;
  lastMessageAt: string;
}

export interface DmMessage {
  messageId: string;
  dmThreadId: number;
  userId: number;
  userName: string;
  userPhotoPath: string | null;
  messageBody: string;
  editedInd: boolean;
  deletedInd: boolean;
  createdDttm: string;
}

const API = import.meta.env.VITE_API_URL ?? "";

export function useBenchDm() {
  const { socket } = useBenchSocket();
  const [threads, setThreads] = useState<DmThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [activeThread, setActiveThread] = useState<DmThread | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Fetch threads
  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/bench/dm/threads`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setThreads(data);
    } catch {
      // silent
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // Fetch messages for active thread
  const fetchMessages = useCallback(async (threadId: number) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`${API}/api/bench/dm/threads/${threadId}/messages`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch {
      // silent
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Open a thread
  const openThread = useCallback((threadId: number, threadInfo?: DmThread) => {
    setActiveThreadId(threadId);
    if (threadInfo) setActiveThread(threadInfo);
    else {
      const found = threads.find((t) => t.dmThreadId === threadId);
      if (found) setActiveThread(found);
    }
    setMessages([]);
    fetchMessages(threadId);
  }, [fetchMessages, threads]);

  // Start a DM with a user (create or get thread)
  const startDm = useCallback(async (recipientId: number) => {
    try {
      const res = await fetch(`${API}/api/bench/dm/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ recipientId }),
      });
      if (!res.ok) return;
      const thread = await res.json();

      // Build a DmThread object so the conversation view can render immediately
      // even if the thread has no messages yet (not in the thread list)
      const threadInfo: DmThread = {
        dmThreadId: thread.dmThreadId,
        otherUserId: recipientId,
        otherUserName: thread.otherUserName ?? "Chef",
        otherUserPhotoPath: thread.otherUserPhotoPath ?? null,
        lastMessage: null,
        lastMessageAt: new Date().toISOString(),
      };

      openThread(thread.dmThreadId, threadInfo);
      fetchThreads();
    } catch {
      // silent
    }
  }, [openThread, fetchThreads]);

  // Send a DM via socket
  const sendDm = useCallback((recipientId: number, body: string) => {
    if (!socket?.connected) return;
    socket.emit("bench:dm:send", { recipientId, body });
  }, [socket]);

  // Close conversation (back to thread list)
  const closeThread = useCallback(() => {
    setActiveThreadId(null);
    setActiveThread(null);
    setMessages([]);
  }, []);

  // Listen for incoming DMs
  useEffect(() => {
    if (!socket) return;

    function onDmNew(msg: DmMessage) {
      // If viewing this thread, append message
      if (msg.dmThreadId === activeThreadId) {
        setMessages((prev) => {
          if (prev.some((m) => m.messageId === msg.messageId)) return prev;
          return [...prev, msg];
        });
      }
      // Update thread list preview
      setThreads((prev) =>
        prev.map((t) =>
          t.dmThreadId === msg.dmThreadId
            ? { ...t, lastMessage: msg.messageBody, lastMessageAt: msg.createdDttm }
            : t,
        ),
      );
      // If thread not in list yet, refetch
      if (!threads.some((t) => t.dmThreadId === msg.dmThreadId)) {
        fetchThreads();
      }
    }

    function onDeleted({ messageId }: { messageId: string }) {
      setMessages((prev) => {
        const updated = prev.filter((m) => m.messageId !== messageId);
        if (updated.length === 0 && activeThreadId) {
          setActiveThreadId(null);
          setActiveThread(null);
        }
        return updated;
      });
      // Always refresh thread list so previews update for both users
      fetchThreads();
    }

    function onEdited({ messageId, newBody, editedInd }: { messageId: string; newBody: string; editedInd: boolean }) {
      setMessages((prev) =>
        prev.map((m) => m.messageId === messageId ? { ...m, messageBody: newBody, editedInd } : m),
      );
    }

    socket.on("bench:dm:new", onDmNew);
    socket.on("bench:message:deleted", onDeleted);
    socket.on("bench:message:edited", onEdited);
    return () => {
      socket.off("bench:dm:new", onDmNew);
      socket.off("bench:message:deleted", onDeleted);
      socket.off("bench:message:edited", onEdited);
    };
  }, [socket, activeThreadId, threads, fetchThreads]);

  return {
    threads,
    loadingThreads,
    activeThreadId,
    activeThread,
    messages,
    loadingMessages,
    openThread,
    closeThread,
    startDm,
    sendDm,
    fetchThreads,
  };
}

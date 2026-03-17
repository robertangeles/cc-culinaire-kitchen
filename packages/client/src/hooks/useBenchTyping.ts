/**
 * @module hooks/useBenchTyping
 *
 * Typing indicator for Bench channels.
 * Emits typing events (debounced) and tracks who's typing.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useBenchSocket } from "../context/BenchSocketContext.js";

export function useBenchTyping(channelKey: string) {
  const { socket } = useBenchSocket();
  const [typingUsers, setTypingUsers] = useState<{ userId: number; userName: string }[]>([]);
  const lastEmitRef = useRef(0);
  const typingTimeoutsRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (!socket) return;

    function onTyping(data: { channelKey: string; userId: number; userName: string }) {
      if (data.channelKey !== channelKey) return;

      // Clear existing timeout for this user
      const existing = typingTimeoutsRef.current.get(data.userId);
      if (existing) clearTimeout(existing);

      // Add to typing list
      setTypingUsers((prev) => {
        if (prev.some((u) => u.userId === data.userId)) return prev;
        return [...prev, { userId: data.userId, userName: data.userName }];
      });

      // Auto-remove after 3s
      typingTimeoutsRef.current.set(
        data.userId,
        setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u.userId !== data.userId));
          typingTimeoutsRef.current.delete(data.userId);
        }, 3000),
      );
    }

    socket.on("bench:typing", onTyping);
    return () => {
      socket.off("bench:typing", onTyping);
      // Clear all timeouts
      for (const t of typingTimeoutsRef.current.values()) clearTimeout(t);
      typingTimeoutsRef.current.clear();
    };
  }, [socket, channelKey]);

  const emitTyping = useCallback(() => {
    if (!socket?.connected) return;
    const now = Date.now();
    // Debounce: only emit every 2 seconds
    if (now - lastEmitRef.current < 2000) return;
    lastEmitRef.current = now;
    socket.emit("bench:typing", { channelKey });
  }, [socket, channelKey]);

  return { typingUsers, emitTyping };
}

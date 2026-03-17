/**
 * @module hooks/useBenchPresence
 *
 * Tracks online users in The Bench.
 * Accepts ALL presence updates (not filtered by channel) since
 * the server broadcasts all connected users globally.
 * Sends heartbeat every 30s to keep presence alive.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useBenchSocket } from "../context/BenchSocketContext.js";

export interface PresenceUser {
  userId: number;
  userName: string;
  userPhotoPath: string | null;
}

export function useBenchPresence(_channelKey: string) {
  const { socket } = useBenchSocket();
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);
  const heartbeatRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (!socket) return;

    function onPresenceUpdate(data: { channelKey: string; users: PresenceUser[] }) {
      // Accept any presence update — server sends all online users
      setOnlineUsers(data.users);
    }

    socket.on("bench:presence:update", onPresenceUpdate);

    // Request fresh presence immediately on mount/reconnect
    if (socket.connected) {
      socket.emit("bench:presence:heartbeat");
    }
    socket.on("connect", () => {
      socket.emit("bench:presence:heartbeat");
    });

    // Heartbeat every 30s
    heartbeatRef.current = setInterval(() => {
      if (socket.connected) socket.emit("bench:presence:heartbeat");
    }, 30_000);

    return () => {
      socket.off("bench:presence:update", onPresenceUpdate);
      socket.off("connect");
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [socket]);

  return { onlineUsers };
}

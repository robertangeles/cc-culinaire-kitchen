/**
 * @module hooks/useBenchPresence
 *
 * Tracks who is online in the open channel of The Bench. The socket also hears other rooms' lists
 * (Everyone's comes back after a reconnect while a kitchen is open), so only the open channel's is kept.
 * Everyone's list holds the people who share a kitchen with the viewer, as the server sends it.
 * Sends heartbeat every 30s to keep presence alive.
 */

import { useState, useEffect, useRef } from "react";
import { useBenchSocket } from "../context/BenchSocketContext.js";

export interface PresenceUser {
  userId: number;
  userName: string;
  userPhotoPath: string | null;
}

export function useBenchPresence(channelKey: string) {
  const { socket } = useBenchSocket();
  // Kept with its channel: another channel's list is never shown.
  const [seen, setSeen] = useState<{ channelKey: string; users: PresenceUser[] } | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (!socket) return;

    function onPresenceUpdate(data: { channelKey: string; users: PresenceUser[] }) {
      if (data.channelKey === channelKey) setSeen(data);
    }
    function onConnect() {
      socket!.emit("bench:presence:heartbeat");
    }

    socket.on("bench:presence:update", onPresenceUpdate);

    // Request fresh presence immediately on mount/reconnect
    if (socket.connected) onConnect();
    socket.on("connect", onConnect);

    // Heartbeat every 30s
    heartbeatRef.current = setInterval(() => {
      if (socket.connected) socket.emit("bench:presence:heartbeat");
    }, 30_000);

    return () => {
      socket.off("bench:presence:update", onPresenceUpdate);
      socket.off("connect", onConnect);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [socket, channelKey]);

  return { onlineUsers: seen?.channelKey === channelKey ? seen.users : [] };
}

/**
 * @module context/BenchSocketContext
 *
 * Socket.io client connection for The Bench community chat.
 * Auto-connects when mounted (authenticated users only).
 * Provides the socket instance to all Bench components.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "./AuthContext.js";

interface BenchSocketContextValue {
  socket: Socket | null;
  connected: boolean;
}

/** socket.io does not reconnect after the server ends a connection itself, as it does when it cannot read this person's blocks. */
const SERVER_DISCONNECT_RETRY_MS = 3_000;

const BenchSocketCtx = createContext<BenchSocketContextValue>({
  socket: null,
  connected: false,
});

export function BenchSocketProvider({ children }: { children: ReactNode }) {
  const { user, isGuest } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Only connect for authenticated (non-guest) users
    if (!user || isGuest) return;

    const apiUrl = import.meta.env.VITE_API_URL ?? "";
    const s = io(apiUrl || window.location.origin, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    s.on("connect", () => {
      setConnected(true);
    });

    let retry: ReturnType<typeof setTimeout> | null = null;
    s.on("disconnect", (reason) => {
      setConnected(false);
      if (reason !== "io server disconnect" || retry) return;
      retry = setTimeout(() => {
        retry = null;
        s.connect();
      }, SERVER_DISCONNECT_RETRY_MS);
    });

    s.on("connect_error", (err) => {
      console.warn("Bench socket connect error:", err.message);
      setConnected(false);
    });

    setSocket(s);

    return () => {
      if (retry) clearTimeout(retry);
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [user, isGuest]);

  return (
    <BenchSocketCtx.Provider value={{ socket, connected }}>
      {children}
    </BenchSocketCtx.Provider>
  );
}

export function useBenchSocket() {
  return useContext(BenchSocketCtx);
}

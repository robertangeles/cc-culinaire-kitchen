import { io } from "socket.io-client";
import { tokenStore } from "../runtime/appContext";
import { apiBaseUrl } from "../config";
import type { LiveSocket } from "./benchLive";

/** The real socket: the access token of the moment goes with every connect (React Native's own WebSocket, no long-polling). Reconnecting after a drop is the library's. */
export function nativeSocket(): LiveSocket {
  return io(apiBaseUrl, {
    autoConnect: false,
    transports: ["websocket"],
    auth: (send) => {
      tokenStore.load().then(
        (t) => send({ token: t?.accessToken }),
        () => send({}),
      );
    },
  });
}

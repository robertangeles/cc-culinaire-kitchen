/**
 * The Bench's live connection: on while a Bench screen is open and the app is in front, back by itself after a drop. Nothing is ever kept to be
 * sent later: what cannot go out now is refused, and the store says so (a post must never appear by itself after the person gave up on it).
 */

/** The part of a socket.io client this uses. */
export interface LiveSocket {
  connected: boolean;
  /** The library will try again by itself. False after the server refused the token, or closed the connection. */
  active: boolean;
  on(event: string, handler: (arg: never) => void): void;
  connect(): void;
  disconnect(): void;
  /** `volatile` drops what cannot be sent now; a plain emit keeps it and sends it at the next connect. */
  volatile: { emit(event: string, payload: unknown): void };
}

export type LiveStatus = "offline" | "connecting" | "online";

/** Waits before trying again after a refusal: the last one repeats. */
const WAITS = [1_000, 5_000, 15_000, 30_000];

/** `renew` makes one ordinary request, which refreshes the sign-in when it has run out; the socket then picks up the new token. */
export function createBenchLive({ socket, renew }: { socket: LiveSocket; renew: () => Promise<unknown> }) {
  let started = false;
  let refusals = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let status: LiveStatus = "offline";
  const statusListeners = new Set<() => void>();
  const connectListeners = new Set<() => void>();

  function setStatus(next: LiveStatus) {
    if (next === status) return;
    status = next;
    statusListeners.forEach((l) => l());
  }

  function connectLater() {
    if (!started || timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (started && !socket.connected) socket.connect();
    }, WAITS[Math.min(refusals, WAITS.length - 1)]);
    refusals += 1;
  }

  socket.on("connect", () => {
    refusals = 0;
    if (!started) return socket.disconnect();
    setStatus("online");
    connectListeners.forEach((l) => l());
  });
  socket.on("disconnect", () => {
    setStatus(started ? "connecting" : "offline");
    if (!socket.active) connectLater();
  });
  socket.on("connect_error", () => {
    if (!started || socket.active) return;
    void renew().catch(() => undefined).then(connectLater);
  });

  return {
    getStatus: () => status,
    subscribe(listener: () => void) {
      statusListeners.add(listener);
      return () => void statusListeners.delete(listener);
    },
    /** Each time the connection is made, the first time and after every drop. */
    onConnect(listener: () => void) {
      connectListeners.add(listener);
      return () => void connectListeners.delete(listener);
    },
    on: (event: string, handler: (payload: unknown) => void) => socket.on(event, handler),
    start() {
      if (started) return;
      started = true;
      setStatus("connecting");
      socket.connect();
    },
    stop() {
      if (!started) return;
      started = false;
      if (timer) clearTimeout(timer);
      timer = null;
      refusals = 0;
      socket.disconnect();
      setStatus("offline");
    },
    /** False when it cannot go out now: it was not kept. */
    send(event: string, payload: unknown): boolean {
      if (!socket.connected) return false;
      socket.volatile.emit(event, payload);
      return true;
    },
  };
}

export type BenchLive = ReturnType<typeof createBenchLive>;

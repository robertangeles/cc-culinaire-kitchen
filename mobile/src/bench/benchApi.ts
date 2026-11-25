import { BenchChannelListSchema, BenchMessagePageSchema, DmThreadListSchema, OpenedThreadSchema, PinListSchema, SearchListSchema, type BenchChannel, type BenchMessage, type BenchPin, type BenchSearchHit, type DmThread } from "@culinaire/shared/schemas/bench";
import type { ApiClient } from "../api/client";

/** One conversation: a channel ("everyone", or a kitchen's "org_<id>") or the direct messages with one person. */
export type Room = { kind: "channel"; key: string } | { kind: "dm"; threadId: number };

export const PAGE = 50;

/** The Bench's lists (`/api/bench`, every signed-in person; the server checks who may read each room). Posting, reactions and typing go over the live channel. */
export function createBenchApi(client: ApiClient) {
  const channel = (key: string) => `/api/bench/channels/${encodeURIComponent(key)}`;
  const path = (room: Room) => (room.kind === "dm" ? `/api/bench/dm/threads/${room.threadId}` : channel(room.key));
  // A picture the server keeps itself has a site-relative path; the phone needs the whole address.
  const whole = (photo: string | null) => (photo?.startsWith("/") ? `${client.baseUrl}${photo}` : photo);
  return {
    whole,
    channels(): Promise<BenchChannel[]> {
      return client.request("GET", "/api/bench/channels", { schema: BenchChannelListSchema });
    },
    async threads(): Promise<DmThread[]> {
      const found = await client.request("GET", "/api/bench/dm/threads", { schema: DmThreadListSchema });
      return found.map((t) => ({ ...t, otherUserPhotoPath: whole(t.otherUserPhotoPath) }));
    },
    /** The thread with this person, made if there is none. */
    async openThread(recipientId: number): Promise<DmThread> {
      const t = await client.request("POST", "/api/bench/dm/threads", { body: { recipientId }, schema: OpenedThreadSchema });
      return { ...t, otherUserId: recipientId, otherUserPhotoPath: whole(t.otherUserPhotoPath), lastMessage: null, lastMessageAt: "" };
    },
    /** Oldest first: the latest page, or the page before a time. */
    async messages(room: Room, before?: string): Promise<BenchMessage[]> {
      const found = await client.request("GET", `${path(room)}/messages?limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ""}`, { schema: BenchMessagePageSchema });
      return found.map((m) => ({ ...m, userPhotoPath: whole(m.userPhotoPath) }));
    },
    pins(key: string): Promise<BenchPin[]> {
      return client.request("GET", `${channel(key)}/pins`, { schema: PinListSchema });
    },
    async pin(key: string, messageId: string): Promise<void> {
      await client.request("POST", `${channel(key)}/pins`, { body: { messageId } });
    },
    async unpin(messageId: string): Promise<void> {
      await client.request("DELETE", `/api/bench/pins/${encodeURIComponent(messageId)}`);
    },
    search(key: string, q: string): Promise<BenchSearchHit[]> {
      return client.request("GET", `${channel(key)}/search?q=${encodeURIComponent(q.trim())}&limit=50`, { schema: SearchListSchema });
    },
  };
}

export type BenchApi = ReturnType<typeof createBenchApi>;

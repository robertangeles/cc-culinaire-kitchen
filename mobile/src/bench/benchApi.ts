import { BenchChannelListSchema, BenchMessagePageSchema, BenchReportListSchema, BlockedListSchema, DmThreadListSchema, OpenedThreadSchema, PinListSchema, SearchListSchema, type BenchChannel, type BenchMessage, type BenchPerson, type BenchPin, type BenchReport, type BenchReportRequest, type BenchSearchHit, type DmThread } from "@culinaire/shared/schemas/bench";
import type { ApiClient } from "../api/client";

/** One conversation: a channel ("everyone", or a kitchen's "org_<id>") or the direct messages with one person. */
export type Room = { kind: "channel"; key: string } | { kind: "dm"; threadId: number };

export const PAGE = 50;

/** The Bench's lists (`/api/bench`, every signed-in person; the server checks who may read each room). Posting, reactions and typing go over the live channel. */
export function createBenchApi(client: ApiClient) {
  const channel = (key: string) => `/api/bench/channels/${encodeURIComponent(key)}`;
  const path = (room: Room) => (room.kind === "dm" ? `/api/bench/dm/threads/${room.threadId}` : channel(room.key));
  // A picture's address is text its owner can edit. As the web's content policy has it, only the site's own uploads and Cloudinary are loaded: anything
  // else would let a stranger's message make this phone call any host. A site path gets the whole address.
  const whole = (photo: string | null) => {
    if (photo && /^\/uploads\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(photo)) return `${client.baseUrl}${photo}`;
    return photo?.startsWith("https://res.cloudinary.com/") ? photo : null;
  };
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
    /** The people this person blocked: the server keeps their messages, reactions, typing and presence from this person. */
    async blocked(): Promise<BenchPerson[]> {
      const found = await client.request("GET", "/api/bench/blocks", { schema: BlockedListSchema });
      return found.map((p) => ({ ...p, userPhotoPath: whole(p.userPhotoPath) }));
    },
    async block(userId: number): Promise<void> {
      await client.request("POST", "/api/bench/blocks", { body: { userId } });
    },
    async unblock(userId: number): Promise<void> {
      await client.request("DELETE", `/api/bench/blocks/${userId}`);
    },
    async report(report: BenchReportRequest): Promise<void> {
      await client.request("POST", "/api/bench/reports", { body: report });
    },
    /** Moderators (`bench:moderate`): the open reports, newest first. */
    reports(): Promise<BenchReport[]> {
      return client.request("GET", "/api/bench/reports?status=open", { schema: BenchReportListSchema });
    },
    async act(id: string, action: "hide" | "dismiss"): Promise<void> {
      await client.request("POST", `/api/bench/reports/${encodeURIComponent(id)}/${action}`, { body: {} });
    },
  };
}

export type BenchApi = ReturnType<typeof createBenchApi>;

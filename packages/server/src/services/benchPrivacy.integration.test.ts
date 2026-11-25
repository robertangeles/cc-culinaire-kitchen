import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { config } from "dotenv";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import jwt from "jsonwebtoken";
import { io, type Socket } from "socket.io-client";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  benchChannel,
  benchDmThread,
  benchMessage,
  benchPin,
  benchReaction,
  organisation,
  user,
  userOrganisation,
} from "../db/schema.js";
import { initBenchSocket } from "./benchSocketService.js";
import { createMessage, getOrCreateOrgChannel, getPinnedMessages, getReactions, pinMessage, softDeleteMessage } from "./benchService.js";
import { createDmMessage, getOrCreateThread } from "./benchDmService.js";
import { leaveOrganisation, removeMember } from "./organisationService.js";
import { removeUserOrganisation } from "./userService.js";
import { anonymiseUser } from "./userAnonymisationService.js";

/**
 * What one person on The Bench can receive that belongs to somebody else, over real sockets and a real database:
 * Anna and Amir in organisation A, Bea in organisation B, Olga in none.
 */
const RUN = process.env.TENANT_IT === "1";

type Event = { name: string; payload: any };
interface Client {
  socket: Socket;
  got: Event[];
  of: (name: string) => any[];
}

describe.skipIf(!RUN)("bench privacy — real sockets, real DB", () => {
  const tag = `benchit_${Date.now()}`;
  let http: HttpServer;
  let port: number;
  let anna: number, amir: number, bea: number, olga: number, leaver: number;
  let orgA: number, orgB: number;
  let channelA: number;
  let everyoneId: number;
  let createdEveryone = false;
  let threadId: number; // Anna and Bea
  const open: Socket[] = [];

  /** Every check waits for the server to settle, so "nothing arrived" means something. */
  const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

  async function connect(userId: number, roles: string[] = []): Promise<Client> {
    const token = jwt.sign({ sub: userId, roles, permissions: [] }, process.env.JWT_ACCESS_SECRET ?? "dev-access-secret");
    const socket = io(`http://127.0.0.1:${port}`, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
    open.push(socket);
    const got: Event[] = [];
    socket.onAny((name, payload) => got.push({ name, payload }));
    // The first broadcast comes once the server has read who this is.
    await new Promise<void>((ok, fail) => {
      socket.once("bench:presence:update", () => ok());
      socket.once("connect_error", fail);
    });
    await settle(50);
    return { socket, got, of: (name) => got.filter((e) => e.name === name).map((e) => e.payload) };
  }

  async function join(c: Client, channelKey: string) {
    c.socket.emit("bench:join", { channelKey });
    await settle();
  }

  async function member(userId: number, organisationId: number) {
    await db.insert(userOrganisation).values({ userId, organisationId, role: "member" });
  }

  beforeAll(async () => {
    const people = await db
      .insert(user)
      .values(["anna", "amir", "bea", "olga", "leaver"].map((n) => ({ userName: n, userEmail: `${tag}-${n}@it.test` })))
      .returning({ userId: user.userId });
    [anna, amir, bea, olga, leaver] = people.map((p) => p.userId);
    const orgs = await db
      .insert(organisation)
      .values([
        { organisationName: `${tag}-A`, joinKey: `${tag}-ka`, createdBy: anna },
        { organisationName: `${tag}-B`, joinKey: `${tag}-kb`, createdBy: bea },
      ])
      .returning({ id: organisation.organisationId });
    [orgA, orgB] = orgs.map((o) => o.id);
    await member(anna, orgA);
    await member(amir, orgA);
    await member(bea, orgB);

    const made = await db
      .insert(benchChannel)
      .values({ channelKey: "everyone", channelName: "Everyone", channelType: "global" })
      .onConflictDoNothing()
      .returning({ id: benchChannel.channelId });
    createdEveryone = made.length > 0;
    [{ id: everyoneId }] = await db
      .select({ id: benchChannel.channelId })
      .from(benchChannel)
      .where(eq(benchChannel.channelKey, "everyone"));
    channelA = (await getOrCreateOrgChannel(orgA, `${tag}-A`)).channelId;
    await getOrCreateOrgChannel(orgB, `${tag}-B`);
    threadId = (await getOrCreateThread(anna, bea)).dmThreadId;

    http = createServer();
    initBenchSocket(http);
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
    port = (http.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const s of open.splice(0)) s.disconnect();
    await settle(50);
  });

  afterAll(async () => {
    const users = [anna, amir, bea, olga, leaver];
    const msgs = await db.select({ id: benchMessage.messageId }).from(benchMessage).where(inArray(benchMessage.userId, users));
    const ids = msgs.map((m) => m.id);
    if (ids.length) {
      await db.delete(benchReaction).where(inArray(benchReaction.messageId, ids));
      await db.delete(benchPin).where(inArray(benchPin.messageId, ids));
      await db.delete(benchMessage).where(inArray(benchMessage.messageId, ids));
    }
    await db.delete(benchDmThread).where(inArray(benchDmThread.userAId, users));
    await db.delete(benchChannel).where(inArray(benchChannel.organisationId, [orgA, orgB]));
    if (createdEveryone) await db.delete(benchChannel).where(eq(benchChannel.channelId, everyoneId));
    await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, [orgA, orgB]));
    await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    await db.delete(user).where(inArray(user.userId, users));
    http.closeAllConnections();
    await new Promise((r) => http.close(r));
  });

  describe("G1 joining a room", () => {
    it("refuses another person's private room, so their direct messages stay theirs", async () => {
      const a = await connect(anna);
      const b = await connect(bea);
      const o = await connect(olga);
      await join(o, `user_${anna}`);
      b.socket.emit("bench:dm:send", { recipientId: anna, body: "private" });
      await settle();

      expect(a.of("bench:dm:new").map((m) => m.messageBody)).toEqual(["private"]);
      expect(b.of("bench:dm:new").map((m) => m.messageBody)).toEqual(["private"]);
      expect(o.of("bench:dm:new")).toEqual([]);
      expect(o.of("bench:error")).toEqual([{ error: expect.any(String), code: "FORBIDDEN" }]);
    });

    it("refuses every name that is not a room the person belongs to", async () => {
      const o = await connect(olga);
      o.got.length = 0;
      const names = [`org_${orgA}`, `dm_${threadId}`, `user_${olga}`, `org_${orgA}x`, `dm_${threadId}_1`, `org_0${orgA}`, "dm_99999999999", "org_", "kitchen", "", "EVERYONE"];
      for (const n of names) await join(o, n);
      // A joined room answers with its presence; nothing may have.
      expect(o.of("bench:presence:update")).toEqual([]);
      expect(o.of("bench:error")).toHaveLength(names.length);
    });

    it("survives a payload that is not a channel", async () => {
      const o = await connect(olga);
      for (const p of [undefined, null, 5, {}, { channelKey: 5 }, { channelKey: ["everyone"] }]) o.socket.emit("bench:join", p);
      await settle();
      expect(o.socket.connected).toBe(true);
      expect(o.of("bench:error")).toHaveLength(6);
    });

    it("still lets a member into the organisation's room and a participant into the thread's", async () => {
      const a = await connect(anna);
      a.got.length = 0;
      await join(a, `org_${orgA}`);
      await join(a, `dm_${threadId}`);
      expect(a.of("bench:presence:update").map((p) => p.channelKey)).toEqual([`org_${orgA}`, `dm_${threadId}`]);
      expect(a.of("bench:error")).toEqual([]);

      const b = await connect(amir);
      await join(b, `org_${orgA}`);
      b.socket.emit("bench:message", { channelKey: `org_${orgA}`, body: "service at 5" });
      await settle();
      expect(a.of("bench:message:new").map((m) => m.messageBody)).toEqual(["service at 5"]);
    });

    it("lets the web come back to Everyone after its tab switch left the room", async () => {
      const a = await connect(anna);
      a.socket.emit("bench:leave", { channelKey: "everyone" });
      await join(a, `org_${orgA}`);
      a.socket.emit("bench:leave", { channelKey: `org_${orgA}` });
      await join(a, "everyone");
      a.got.length = 0;
      const o = await connect(olga);
      o.socket.emit("bench:message", { channelKey: "everyone", body: "hello all" });
      await settle();
      expect(a.of("bench:message:new").map((m) => m.messageBody)).toEqual(["hello all"]);
    });
  });

  describe("G2 presence in an organisation or direct message room", () => {
    it("lists only the people in that room", async () => {
      await connect(bea);
      await connect(olga);
      const a = await connect(anna);
      const second = await connect(anna);
      const b = await connect(amir);
      await join(a, `org_${orgA}`);
      await join(second, `org_${orgA}`);
      await join(b, `org_${orgA}`);
      const last = a.of("bench:presence:update").filter((p) => p.channelKey === `org_${orgA}`).pop();
      expect(last.users.map((u: any) => u.userId).sort()).toEqual([anna, amir].sort());

      await join(a, `dm_${threadId}`);
      const dm = a.of("bench:presence:update").filter((p) => p.channelKey === `dm_${threadId}`).pop();
      expect(dm.users.map((u: any) => u.userId)).toEqual([anna]);
    });

    it("leaves Everyone as it is until the owner decides", async () => {
      await connect(bea);
      const a = await connect(anna);
      const last = a.of("bench:presence:update").filter((p) => p.channelKey === "everyone").pop();
      expect(last.users.map((u: any) => u.userId)).toEqual(expect.arrayContaining([anna, bea]));
    });

    it("drops a person from the room's list when they leave it", async () => {
      const a = await connect(anna);
      const b = await connect(amir);
      await join(a, `org_${orgA}`);
      await join(b, `org_${orgA}`);
      b.socket.emit("bench:leave", { channelKey: `org_${orgA}` });
      await settle();
      const last = a.of("bench:presence:update").filter((p) => p.channelKey === `org_${orgA}`).pop();
      expect(last.users.map((u: any) => u.userId)).toEqual([anna]);
    });
  });

  describe("G3 reactions", () => {
    it("on an organisation message reach its room and nobody else", async () => {
      const msg = await createMessage(channelA, anna, "org only");
      const a = await connect(anna);
      const b = await connect(amir);
      const o = await connect(olga);
      await join(a, `org_${orgA}`);
      await join(b, `org_${orgA}`);
      a.socket.emit("bench:reaction:add", { messageId: msg.messageId, emoji: "x" });
      await settle();
      a.socket.emit("bench:reaction:remove", { messageId: msg.messageId, emoji: "x" });
      await settle();
      for (const c of [a, b]) {
        expect(c.of("bench:reaction:updated")).toEqual([
          { messageId: msg.messageId, reactions: [{ emoji: "x", count: 1, userIds: [anna] }] },
          { messageId: msg.messageId, reactions: [] },
        ]);
      }
      expect(o.of("bench:reaction:updated")).toEqual([]);
    });

    it("on a direct message reach both people once and nobody else", async () => {
      const msg = await createDmMessage(threadId, anna, "dm");
      const a = await connect(anna);
      const b = await connect(bea);
      const o = await connect(olga);
      b.socket.emit("bench:reaction:add", { messageId: msg.messageId, emoji: "y" });
      await settle();
      expect(a.of("bench:reaction:updated")).toHaveLength(1);
      expect(b.of("bench:reaction:updated")).toHaveLength(1);
      expect(o.of("bench:reaction:updated")).toEqual([]);
    });

    it("are refused from someone outside the organisation or the thread, and nothing is stored", async () => {
      const org = await createMessage(channelA, anna, "org only");
      const dm = await createDmMessage(threadId, anna, "dm");
      const o = await connect(olga);
      for (const messageId of [org.messageId, dm.messageId]) o.socket.emit("bench:reaction:add", { messageId, emoji: "z" });
      await settle();
      expect(await getReactions(org.messageId)).toEqual([]);
      expect(await getReactions(dm.messageId)).toEqual([]);

      // A reaction left while a member may not be touched (or its reactors read back) after leaving either.
      await db.insert(benchReaction).values({ messageId: org.messageId, userId: olga, emoji: "z" });
      o.socket.emit("bench:reaction:remove", { messageId: org.messageId, emoji: "z" });
      await settle();
      expect(await getReactions(org.messageId)).toHaveLength(1);
      expect(o.of("bench:reaction:updated")).toEqual([]);
    });

    it("on an Everyone message still reach everyone", async () => {
      const msg = await createMessage(everyoneId, anna, "public");
      const a = await connect(anna);
      const o = await connect(olga);
      a.socket.emit("bench:reaction:add", { messageId: msg.messageId, emoji: "x" });
      await settle();
      expect(o.of("bench:reaction:updated")).toHaveLength(1);
    });
  });

  it("G5 a deleted message is not in the pinned list", async () => {
    const kept = await createMessage(channelA, anna, "kept");
    const gone = await createMessage(channelA, anna, "secret recipe cost");
    await pinMessage(kept.messageId, channelA, anna);
    await pinMessage(gone.messageId, channelA, anna);
    await softDeleteMessage(gone.messageId, anna);
    expect((await getPinnedMessages(channelA)).map((p) => p.messageBody)).toEqual(["kept"]);
  });

  describe("G6 a removed member stops receiving the organisation's channel", () => {
    const ways: [string, () => Promise<unknown>][] = [
      ["removed by an admin", () => removeMember(orgA, leaver)],
      ["leaving", () => leaveOrganisation(leaver, orgA)],
      ["detached by a platform administrator", () => removeUserOrganisation(leaver)],
      ["deleting the account", () => anonymiseUser(leaver)],
    ];
    it.each(ways)("%s", async (_how, remove) => {
      await member(leaver, orgA);
      const a = await connect(anna);
      const l = await connect(leaver);
      const l2 = await connect(leaver); // every device, not only one
      for (const c of [a, l, l2]) await join(c, `org_${orgA}`);
      await remove();
      await settle();
      a.socket.emit("bench:message", { channelKey: `org_${orgA}`, body: "after removal" });
      await settle();
      expect(a.of("bench:message:new").map((m) => m.messageBody)).toEqual(["after removal"]);
      expect(l.of("bench:message:new")).toEqual([]);
      expect(l2.of("bench:message:new")).toEqual([]);
      const last = a.of("bench:presence:update").filter((p) => p.channelKey === `org_${orgA}`).pop();
      expect(last.users.map((u: any) => u.userId)).toEqual([anna]);
      await db.delete(userOrganisation).where(and(eq(userOrganisation.userId, leaver), eq(userOrganisation.organisationId, orgA)));
    });
  });

  describe("G7 editing and deleting", () => {
    it("announce to the stored message's room, whatever room the sender names", async () => {
      const msg = await createMessage(channelA, anna, "org only");
      const a = await connect(anna);
      const b = await connect(amir);
      const o = await connect(olga);
      await join(a, `org_${orgA}`);
      await join(b, `org_${orgA}`);
      a.socket.emit("bench:message:edit", { messageId: msg.messageId, channelKey: "everyone", newBody: "edited" });
      await settle();
      a.socket.emit("bench:message:delete", { messageId: msg.messageId, channelKey: `user_${olga}` });
      await settle();
      expect(b.of("bench:message:edited")).toEqual([{ messageId: msg.messageId, newBody: "edited", editedInd: true }]);
      expect(b.of("bench:message:deleted")).toEqual([{ messageId: msg.messageId }]);
      expect(o.of("bench:message:edited")).toEqual([]);
      expect(o.of("bench:message:deleted")).toEqual([]);
    });

    it("on a direct message reach both people", async () => {
      const msg = await createDmMessage(threadId, anna, "dm");
      const a = await connect(anna);
      const b = await connect(bea);
      const o = await connect(olga);
      a.socket.emit("bench:message:edit", { messageId: msg.messageId, channelKey: `org_${orgB}`, newBody: "dm 2" });
      await settle();
      a.socket.emit("bench:message:delete", { messageId: msg.messageId, channelKey: `dm_${threadId}` });
      await settle();
      for (const c of [a, b]) {
        expect(c.of("bench:message:edited")).toHaveLength(1);
        expect(c.of("bench:message:deleted")).toHaveLength(1);
      }
      expect(o.got.filter((e) => e.name.startsWith("bench:message"))).toEqual([]);
    });

    it("a former member cannot put new text into the organisation's channel by editing", async () => {
      const msg = await createMessage(channelA, olga, "written while a member");
      const a = await connect(anna);
      const o = await connect(olga);
      await join(a, `org_${orgA}`);
      o.socket.emit("bench:message:edit", { messageId: msg.messageId, channelKey: `org_${orgA}`, newBody: "after leaving" });
      await settle();
      const [row] = await db.select({ body: benchMessage.messageBody }).from(benchMessage).where(eq(benchMessage.messageId, msg.messageId));
      expect(row.body).toBe("written while a member");
      expect(a.of("bench:message:edited")).toEqual([]);
    });

    it("an administrator still moderates any message", async () => {
      const msg = await createMessage(channelA, anna, "rude");
      const a = await connect(anna);
      const admin = await connect(olga, ["Administrator"]);
      await join(a, `org_${orgA}`);
      admin.socket.emit("bench:message:delete", { messageId: msg.messageId, channelKey: `org_${orgA}` });
      await settle();
      expect(a.of("bench:message:deleted")).toEqual([{ messageId: msg.messageId }]);
    });
  });
});

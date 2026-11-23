import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

const recordChatTurn = vi.hoisted(() => vi.fn());
vi.mock("../services/brainCaptureService.js", () => ({ recordChatTurn }));

import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db } from "../db/index.js";
import { conversation, message, user } from "../db/schema.js";
import { handleSaveMessages } from "./conversationController.js";

/**
 * A save whose reply is lost is re-sent by the client. The message rows are deduplicated by id; this
 * proves the Brain memory is too: only messages this request actually inserted are recorded.
 * Gated like the other real-DB suites (TENANT_IT=1); self-cleaning.
 */
const RUN = process.env.TENANT_IT === "1";

describe.skipIf(!RUN)("save messages — Brain memory is recorded once per turn", () => {
  const tag = `brainreplay_${Date.now()}`;
  const convId = `${tag}-conv`;
  let userId: number;

  const msg = (n: number, role: "user" | "assistant", body: string) => ({
    messageId: `${tag}-m${n}`,
    messageRole: role,
    messageBody: body,
    messageSequence: n,
  });
  const turn1 = [msg(0, "user", "How long to rest a steak?"), msg(1, "assistant", "Five minutes.")];
  const turn2 = [msg(2, "user", "And a roast?"), msg(3, "assistant", "Twenty minutes.")];

  async function save(messages: unknown[]) {
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
    const req = { params: { id: convId }, body: { messages }, user: { sub: userId } } as unknown as Request;
    await handleSaveMessages(req, res, vi.fn() as unknown as NextFunction);
    return res;
  }

  beforeAll(async () => {
    [{ userId }] = await db
      .insert(user)
      .values({ userName: "IT Replay", userEmail: `${tag}@it.test` })
      .returning({ userId: user.userId });
    await db.insert(conversation).values({ conversationId: convId, userId, conversationTitle: "t" });
  });

  afterAll(async () => {
    await db.delete(message).where(eq(message.conversationId, convId));
    await db.delete(conversation).where(eq(conversation.conversationId, convId));
    await db.delete(user).where(eq(user.userId, userId));
  });

  beforeEach(() => recordChatTurn.mockClear());

  it("the same save posted twice writes one memory and keeps the response shape", async () => {
    const first = await save(turn1);
    const second = await save(turn1);
    expect(first.json).toHaveBeenCalledWith({ success: true });
    expect(second.json).toHaveBeenCalledWith({ success: true });
    expect(recordChatTurn).toHaveBeenCalledTimes(1);
  });

  it("one old and one new turn writes one memory, holding only the new turn", async () => {
    await save([...turn1, ...turn2]);
    expect(recordChatTurn).toHaveBeenCalledTimes(1);
    const raw = recordChatTurn.mock.calls[0][0].rawContent as string;
    expect(raw).toContain("And a roast?");
    expect(raw).not.toContain("rest a steak");
  });
});

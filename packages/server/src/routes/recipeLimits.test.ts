import { describe, it, expect, afterAll } from "vitest";
import express, { type Router } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { recipesRouter } from "./recipes.js";
import { chatRouter } from "./chat.js";
import {
  chatRateLimit,
  recipeGenerateRateLimit,
  recipeRefineRateLimit,
  recipeImageRateLimit,
  recipeEmailRateLimit,
  recipeEmailGuestAddressRateLimit,
  recipeEmailRecipientRateLimit,
  recipientKey,
} from "../middleware/rateLimiter.js";

/** The handlers wired onto a route, in order, read off the real router (as authMfaRoutes.test.ts does). */
function handlersOf(router: Router, method: "get" | "post" | "patch", path: string): unknown[] {
  const layer = router.stack.find((l) => l.route?.path === path && (l.route as { methods: Record<string, boolean> }).methods[method]);
  if (!layer?.route) throw new Error(`no ${method} ${path}`);
  return layer.route.stack.map((l) => l.handle);
}

describe("model-backed routes are rate limited per user", () => {
  it.each([
    ["post", "/generate", recipeGenerateRateLimit],
    ["post", "/patisserie", recipeGenerateRateLimit],
    ["post", "/spirits", recipeGenerateRateLimit],
    ["post", "/:id/refine", recipeRefineRateLimit],
    ["post", "/:id/regenerate-image", recipeImageRateLimit],
    ["post", "/:id/email", recipeEmailRateLimit],
    ["post", "/:id/email", recipeEmailGuestAddressRateLimit],
    ["post", "/:id/email", recipeEmailRecipientRateLimit],
  ] as const)("recipes %s %s", (method, path, limiter) => {
    expect(handlersOf(recipesRouter, method, path)).toContain(limiter);
  });

  it("chat and its image route keep theirs", () => {
    expect(handlersOf(chatRouter, "post", "/")).toContain(chatRateLimit);
    expect(handlersOf(chatRouter, "post", "/image")).toContain(chatRateLimit);
  });
});

describe("the limiters count per person, not per address", () => {
  let server: Server;
  afterAll(() => server?.close());

  async function post(limiter: express.RequestHandler, who: string, body: object = {}) {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": who },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
  }

  it("answers the user over the limit with 429 RATE_LIMITED, and leaves the next user alone", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const who = req.headers["x-test-user"];
      if (typeof who === "string" && who.startsWith("u")) req.user = { sub: Number(who.slice(1)), roles: [], permissions: [] };
      next();
    });
    app.post("/x", recipeGenerateRateLimit, (_req, res) => res.sendStatus(200));
    server = app.listen(0);

    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await post(recipeGenerateRateLimit, "u1")).status);
    const blocked = await post(recipeGenerateRateLimit, "u1");

    expect(statuses).toEqual(Array(10).fill(200));
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("RATE_LIMITED");
    expect((await post(recipeGenerateRateLimit, "u2")).status).toBe(200);
  });
});

describe("recipe emails from guests are also counted per address", () => {
  let server: Server;
  afterAll(() => server?.close());

  it("fifty guest tokens behind one address send ten between them; signed-in users there are not counted", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const who = String(req.headers["x-test-who"]);
      if (who.startsWith("u")) req.user = { sub: Number(who.slice(1)), roles: [], permissions: [] };
      else req.guestToken = who;
      next();
    });
    app.post("/x", recipeEmailRateLimit, recipeEmailGuestAddressRateLimit, recipeEmailRecipientRateLimit, (_req, res) => res.sendStatus(200));
    server = app.listen(0);
    const send = async (who: string, to: string) => {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-who": who },
        body: JSON.stringify({ to }),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
    };

    const answers = [];
    for (let i = 0; i < 50; i++) answers.push(await send(`guest-${i}`, `inbox-${i}@example.com`));

    expect(answers.filter((a) => a.status === 200)).toHaveLength(10);
    expect(answers[10].status).toBe(429);
    expect(answers[10].body.code).toBe("RATE_LIMITED");
    expect((await send("u71", "user-one@example.com")).status).toBe(200);
    expect((await send("u72", "user-two@example.com")).status).toBe(200);
  });
});

describe("recipientKey: addresses that reach one inbox count as one", () => {
  it.each([
    ["Cook@Example.com", "cook@example.com"],
    ["  cook@example.com ", "cook@example.com"],
    ["cook+spam1@example.com", "cook@example.com"],
    ["cook+a+b@example.com", "cook@example.com"],
    ["c.o.o.k@gmail.com", "cook@gmail.com"],
    ["cook+x@googlemail.com", "cook@gmail.com"],
  ])("%s -> %s", (given, same) => {
    expect(recipientKey(given)).toBe(recipientKey(same));
  });

  it("keeps dots for other providers, where they are a different mailbox", () => {
    expect(recipientKey("c.ook@example.com")).not.toBe(recipientKey("cook@example.com"));
  });

  it("keeps different people apart", () => {
    expect(recipientKey("a@example.com")).not.toBe(recipientKey("b@example.com"));
  });

  it("is null for anything that is not an address, so the handler can answer 400 instead of sharing a bucket", () => {
    for (const bad of [undefined, 42, "", "no-at-sign", "@example.com", "cook@", "+tag@example.com"]) expect(recipientKey(bad)).toBeNull();
  });
});

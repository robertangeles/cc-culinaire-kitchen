import { describe, it, expect, vi } from "vitest";
import { createApiClient, ApiError, type TokenStore, type Tokens } from "./client";

function memoryTokens(initial: Tokens | null): TokenStore & { current: Tokens | null } {
  const store = {
    current: initial,
    load: async () => store.current,
    save: async (t: Tokens) => void (store.current = t),
    clear: async () => void (store.current = null),
  };
  return store;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup(responses: Array<Response | Error | ((req: Request) => Response | Promise<Response>)>, tokens: Tokens | null = { accessToken: "A1", refreshToken: "R1" }) {
  const seen: Request[] = [];
  const queue = [...responses];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as string, init);
    seen.push(req);
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra request " + req.url);
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(req) : next;
  });
  const store = memoryTokens(tokens);
  const onSessionExpired = vi.fn();
  const client = createApiClient({ baseUrl: "https://api.test", tokenStore: store, appVersion: "0.1.0", fetchFn, onSessionExpired, timeoutMs: 50 });
  return { client, store, seen, fetchFn, onSessionExpired };
}

describe("api client request basics", () => {
  it("sends the bearer token, app version and JSON body, and returns parsed JSON", async () => {
    const { client, seen } = setup([json(200, { ok: true })]);
    const out = await client.request<{ ok: boolean }>("POST", "/api/x", { body: { a: 1 } });
    expect(out).toEqual({ ok: true });
    expect(seen[0].url).toBe("https://api.test/api/x");
    expect(seen[0].headers.get("authorization")).toBe("Bearer A1");
    expect(seen[0].headers.get("x-mobile-app-version")).toBe("0.1.0");
    expect(seen[0].headers.get("content-type")).toBe("application/json");
    expect(await seen[0].json()).toEqual({ a: 1 });
  });

  it("sends no Authorization header when auth is off, and never tries to refresh a 401", async () => {
    const { client, seen, fetchFn } = setup([json(401, { error: "Invalid email or password." })]);
    await expect(client.request("POST", "/api/auth/login", { body: {}, auth: false })).rejects.toMatchObject({ code: "unauthorized", message: "Invalid email or password." });
    expect(seen[0].headers.get("authorization")).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns undefined for an empty body", async () => {
    const { client } = setup([new Response(null, { status: 204 })]);
    expect(await client.request("DELETE", "/api/x")).toBeUndefined();
  });
});

describe("token refresh on 401", () => {
  it("refreshes once, saves the new tokens and retries the request", async () => {
    const { client, store, seen } = setup([
      json(401, { error: "expired" }),
      json(200, { user: {}, tokens: { accessToken: "A2", refreshToken: "R1" } }),
      json(200, { ok: 1 }),
    ]);
    expect(await client.request("GET", "/api/x")).toEqual({ ok: 1 });
    expect(seen[1].url).toBe("https://api.test/api/auth/refresh");
    expect(await seen[1].json()).toEqual({ refreshToken: "R1" });
    expect(seen[1].headers.get("authorization")).toBeNull();
    expect(seen[2].headers.get("authorization")).toBe("Bearer A2");
    expect(store.current).toEqual({ accessToken: "A2", refreshToken: "R1" });
  });

  it("shares one refresh between simultaneous 401s", async () => {
    const calls: string[] = [];
    const { client } = setup([
      (r) => (calls.push(r.url), json(401, {})),
      (r) => (calls.push(r.url), json(401, {})),
      (r) => (calls.push(r.url), json(200, { tokens: { accessToken: "A2", refreshToken: "R1" } })),
      (r) => (calls.push(r.url), json(200, { n: 1 })),
      (r) => (calls.push(r.url), json(200, { n: 2 })),
    ]);
    const [a, b] = await Promise.all([client.request("GET", "/api/a"), client.request("GET", "/api/b")]);
    expect([a, b]).toEqual([{ n: 1 }, { n: 2 }]);
    expect(calls.filter((u) => u.endsWith("/api/auth/refresh"))).toHaveLength(1);
  });

  it("clears the tokens and reports the session expired when the refresh token is refused", async () => {
    const { client, store, onSessionExpired } = setup([json(401, {}), json(401, { error: "Session expired. Please log in again." })]);
    await expect(client.request("GET", "/api/x")).rejects.toMatchObject({ code: "unauthorized" });
    expect(store.current).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("keeps the tokens when the refresh fails only because the network is down", async () => {
    const { client, store, onSessionExpired } = setup([json(401, {}), new TypeError("Network request failed")]);
    await expect(client.request("GET", "/api/x")).rejects.toMatchObject({ code: "network" });
    expect(store.current).toEqual({ accessToken: "A1", refreshToken: "R1" });
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("does not refresh again when the retried request is still 401", async () => {
    const { client, fetchFn } = setup([json(401, {}), json(200, { tokens: { accessToken: "A2", refreshToken: "R1" } }), json(401, { error: "no" })]);
    await expect(client.request("GET", "/api/x")).rejects.toMatchObject({ code: "unauthorized" });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("is unauthorized without calling the server when there are no tokens", async () => {
    const { client, fetchFn } = setup([], null);
    await expect(client.request("GET", "/api/x")).rejects.toMatchObject({ code: "unauthorized" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("error mapping (the offline queue branches on these codes)", () => {
  it.each([
    [400, "bad_request"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [426, "upgrade_required"],
    [429, "rate_limited"],
    [500, "server"],
    [503, "server"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const { client } = setup([json(status, { error: "why" })]);
    const err = await client.request("GET", "/api/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status, code, message: "why" });
  });

  it("keeps the response body so callers can read structured details (the 409 missing list)", async () => {
    const body = { error: "Count these", missing: [{ ingredientId: "i1", ingredientName: "Shiraz", areaNames: ["Bar"] }] };
    const { client } = setup([json(409, body)]);
    const err = (await client.request("POST", "/api/x").catch((e) => e)) as ApiError;
    expect(err.body).toEqual(body);
  });

  it("falls back to a plain sentence when the error body has no message", async () => {
    const { client } = setup([new Response("<html>bad gateway</html>", { status: 502 })]);
    const err = await client.request("GET", "/api/x").catch((e) => e);
    expect(err).toMatchObject({ code: "server", message: "The server had a problem. Try again." });
  });

  it("maps a failed fetch to network and a stalled one to timeout", async () => {
    const down = setup([new TypeError("Network request failed")]);
    await expect(down.client.request("GET", "/api/x")).rejects.toMatchObject({ code: "network", message: "Can't reach the server. Try again." });

    const slow = setup([(req) => new Promise<Response>((_, reject) => req.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))]);
    await expect(slow.client.request("GET", "/api/x")).rejects.toMatchObject({ code: "timeout" });
  });
});

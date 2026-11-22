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

  it("keeps the tokens and raises bad_response when the refresh reply is not the expected shape", async () => {
    const { client, store, onSessionExpired } = setup([json(401, {}), json(200, { html: "captive portal" })]);
    await expect(client.request("GET", "/api/x")).rejects.toMatchObject({ code: "bad_response" });
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

  it("times out a response whose body stalls after the headers, instead of hanging forever", async () => {
    const stalledBody = (req: Request) => {
      const body = new ReadableStream({ start(controller) { req.signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError"))); } });
      return new Response(body, { status: 200 });
    };
    const { client } = setup([stalledBody]);
    await expect(client.request("GET", "/api/x")).rejects.toMatchObject({ code: "timeout" });
  });

  it("maps a failed fetch to network and a stalled one to timeout", async () => {
    const down = setup([new TypeError("Network request failed")]);
    await expect(down.client.request("GET", "/api/x")).rejects.toMatchObject({ code: "network", message: "Can't reach the server. Try again." });

    const slow = setup([(req) => new Promise<Response>((_, reject) => req.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))]);
    await expect(slow.client.request("GET", "/api/x")).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("the server's own error code", () => {
  it("keeps it upper-cased as serverCode and matches it case-insensitively, whatever the status", async () => {
    const { client } = setup([json(409, { error: "Already received.", code: "already_confirmed" })]);
    const err = (await client.request("POST", "/api/x").catch((e) => e)) as ApiError;
    expect(err).toMatchObject({ code: "conflict", serverCode: "ALREADY_CONFIRMED", message: "Already received." });
    expect(err.hasCode("ALREADY_CONFIRMED")).toBe(true);
    expect(err.hasCode("something_else")).toBe(false);
  });

  it("has no serverCode when the body sends none, sends one that is not text, or is not JSON", async () => {
    for (const res of [json(400, { error: "no code" }), json(400, { error: "x", code: 12 }), new Response("nope", { status: 400 })]) {
      const err = (await setup([res]).client.request("GET", "/api/x").catch((e) => e)) as ApiError;
      expect(err.serverCode).toBeUndefined();
    }
  });

  it("reads the message of an older body that sends `error` as an object", async () => {
    const { client } = setup([json(400, { error: { message: "Name is required" } })]);
    await expect(client.request("POST", "/api/x")).rejects.toMatchObject({ message: "Name is required" });
  });
});

describe("response schemas", () => {
  const schema = { parse: (d: unknown) => (d as { n?: unknown }).n as number };
  const strict = { parse: (d: unknown) => { if (typeof (d as { n?: unknown })?.n !== "number") throw new Error("shape"); return (d as { n: number }).n; } };

  it("returns what the schema makes of the reply", async () => {
    expect(await setup([json(200, { n: 4 })]).client.request("GET", "/api/x", { schema })).toBe(4);
  });

  it("reports a reply that fails the schema as bad_response, keeping the body, not as a crash", async () => {
    const err = (await setup([json(200, { n: "x" })]).client.request("GET", "/api/x", { schema: strict }).catch((e) => e)) as ApiError;
    expect(err).toMatchObject({ code: "bad_response", status: 200, body: { n: "x" } });
  });
});

describe("multipart upload", () => {
  it("sends a FormData as multipart, with the bearer token and no JSON content type", async () => {
    const { client, seen } = setup([json(200, { id: "d1" })]);
    const form = new FormData();
    form.append("file", new Blob(["pdf-bytes"], { type: "application/pdf" }), "doc.pdf");
    form.append("kind", "licence");
    expect(await client.request("POST", "/api/compliance/upload", { body: form })).toEqual({ id: "d1" });
    expect(seen[0].headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen[0].headers.get("authorization")).toBe("Bearer A1");
    const received = (await seen[0].formData()) as unknown as { get(name: string): unknown };
    expect(received.get("kind")).toBe("licence");
    expect((received.get("file") as File).name).toBe("doc.pdf");
  });

  it("still retries an upload once after a refresh", async () => {
    const { client, seen } = setup([json(401, {}), json(200, { tokens: { accessToken: "A2", refreshToken: "R1" } }), json(200, { ok: 1 })]);
    const form = new FormData();
    form.append("kind", "licence");
    await client.request("POST", "/api/x", { body: form });
    expect(seen[2].headers.get("authorization")).toBe("Bearer A2");
    expect(((await seen[2].formData()) as unknown as { get(name: string): unknown }).get("kind")).toBe("licence");
  });
});

describe("binary download", () => {
  it("returns the body as a Blob with its type", async () => {
    const { client, seen } = setup([new Response("%PDF-1.7", { status: 200, headers: { "content-type": "application/pdf" } })]);
    const blob = await client.download("/api/orders/1/pdf");
    expect(blob.type).toBe("application/pdf");
    expect(await blob.text()).toBe("%PDF-1.7");
    expect(seen[0].method).toBe("GET");
    expect(seen[0].headers.get("accept")).toBe("*/*");
  });

  it("raises the server's error, with its code, instead of handing back an error page as a file", async () => {
    const { client } = setup([json(404, { error: "No such order", code: "ORDER_NOT_FOUND" })]);
    await expect(client.download("/api/orders/9/pdf")).rejects.toMatchObject({ code: "not_found", serverCode: "ORDER_NOT_FOUND" });
  });
});

describe("per-call timeout and abort", () => {
  const never = (req: Request) => new Promise<Response>((_, reject) => req.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

  it("lets one call wait longer than the client default", async () => {
    const slowButFine = () => new Promise<Response>((resolve) => setTimeout(() => resolve(json(200, { ok: 1 })), 120));
    const { client } = setup([slowButFine]); // client default is 50 ms
    expect(await client.request("GET", "/api/x", { timeoutMs: 1000 })).toEqual({ ok: 1 });
  });

  it("lets one call give up sooner", async () => {
    const { client } = setup([never]);
    await expect(client.request("GET", "/api/x", { timeoutMs: 5 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("reports the caller's own abort as aborted, not as a network or timeout failure", async () => {
    const { client, fetchFn } = setup([never]);
    const controller = new AbortController();
    const pending = client.request("GET", "/api/x", { signal: controller.signal, timeoutMs: 1000 });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled()); // abort while the request is in flight
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it("does not even send a call whose signal is already aborted", async () => {
    const { client, fetchFn } = setup([never]);
    await expect(client.request("GET", "/api/x", { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "aborted" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("streamed response", () => {
  const enc = new TextEncoder();
  const streamOf = (chunks: Uint8Array[], then?: () => void) =>
    new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); if (then) then(); else c.close(); } }), { status: 200 });
  const collect = async (it: AsyncIterable<string>) => { let out = ""; for await (const p of it) out += p; return out; };

  it("yields text pieces as they arrive, even when a character is split across two chunks", async () => {
    const bytes = enc.encode("a€b"); // € is three bytes
    const { client } = setup([streamOf([bytes.slice(0, 2), bytes.slice(2)])]);
    const pieces: string[] = [];
    for await (const p of client.stream("POST", "/api/chat", { body: { message: "hi" } })) pieces.push(p);
    expect(pieces.join("")).toBe("a€b");
    expect(pieces.length).toBeGreaterThan(1);
  });

  it("refreshes an expired token before streaming, like any other call", async () => {
    const { client, seen } = setup([json(401, {}), json(200, { tokens: { accessToken: "A2", refreshToken: "R1" } }), streamOf([enc.encode("ok")])]);
    expect(await collect(client.stream("GET", "/api/x"))).toBe("ok");
    expect(seen[2].headers.get("authorization")).toBe("Bearer A2");
  });

  it("raises the server's error when the stream cannot start", async () => {
    const { client } = setup([json(429, { error: "Slow down", code: "RATE_LIMITED" })]);
    await expect(collect(client.stream("POST", "/api/chat"))).rejects.toMatchObject({ code: "rate_limited", serverCode: "RATE_LIMITED" });
  });

  it("stops with aborted when the caller's signal fires mid-stream, and keeps the pieces already read", async () => {
    const controller = new AbortController();
    const body = (req: Request) => {
      void req;
      return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode("one ")); controller.signal.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError"))); } }), { status: 200 });
    };
    const { client } = setup([body]);
    const got: string[] = [];
    await expect((async () => { for await (const p of client.stream("GET", "/api/x", { signal: controller.signal })) { got.push(p); controller.abort(); } })()).rejects.toMatchObject({ code: "aborted" });
    expect(got).toEqual(["one "]);
  });

  it("times out only the wait for the first byte, not a long answer", async () => {
    const late = () => new Promise<Response>((resolve) => setTimeout(() => resolve(streamOf([enc.encode("late")])), 5));
    const { client } = setup([late]);
    expect(await collect(client.stream("GET", "/api/x", { timeoutMs: 1000 }))).toBe("late");

    const stuck = setup([(req) => new Promise<Response>((_, reject) => req.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))]);
    await expect(collect(stuck.client.stream("GET", "/api/x", { timeoutMs: 5 }))).rejects.toMatchObject({ code: "timeout" });
  });

  it("uses the streaming fetch when one is given", async () => {
    const streamFetchFn = vi.fn(async () => streamOf([enc.encode("via expo")]));
    const fetchFn = vi.fn();
    const client = createApiClient({ baseUrl: "https://api.test", tokenStore: memoryTokens({ accessToken: "A1", refreshToken: "R1" }), appVersion: "0.1.0", fetchFn: fetchFn as unknown as typeof fetch, streamFetchFn: streamFetchFn as unknown as typeof fetch });
    expect(await collect(client.stream("GET", "/api/x"))).toBe("via expo");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

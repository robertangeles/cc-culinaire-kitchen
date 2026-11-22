import { describe, it, expect, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { createWasteApi } from "./wasteApi";

describe("waste calls", () => {
  it("asks for one local day at one location, with timestamps (a bare date would mean a UTC day)", async () => {
    const request = vi.fn(async () => ({ data: [], total: 0 }));
    await createWasteApi({ request } as unknown as ApiClient).list({ start: "2026-11-22T13:00:00.000Z", end: "2026-11-23T12:59:59.999Z" }, "L 1");
    const [method, path] = request.mock.calls[0] as unknown as [string, string];
    expect(method).toBe("GET");
    expect(path).toBe("/api/waste?limit=200&startDate=2026-11-22T13%3A00%3A00.000Z&endDate=2026-11-23T12%3A59%3A59.999Z&storeLocationId=L%201");
  });

  it("reads the rows and names the server suggests", async () => {
    // The real client parses each reply with the schema it is given; so does this stand-in.
    const reply = (path: string) => (path.startsWith("/api/waste/suggestions") ? { ingredients: ["Basil"] } : { data: [{ wasteLogId: "w1", ingredientName: "Basil", quantity: "1.000", unit: "bunch", loggedAt: "2026-11-23T01:00:00.000Z" }], total: 1 });
    const request = vi.fn(async (_m: string, path: string, opts: { schema: { parse(d: unknown): unknown } }) => opts.schema.parse(reply(path)));
    const api = createWasteApi({ request } as unknown as ApiClient);
    expect((await api.list({ start: "a", end: "b" }, "L1"))[0]).toMatchObject({ wasteLogId: "w1", quantity: 1 });
    expect(await api.suggestions("bas il")).toEqual(["Basil"]);
    expect(request.mock.calls[1][1]).toBe("/api/waste/suggestions?q=bas%20il");
  });
});

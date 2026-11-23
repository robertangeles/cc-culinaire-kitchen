import { describe, it, expect, vi } from "vitest";
import { createReceivingApi } from "./receivingApi";
import type { ApiClient } from "../api/client";

const make = (reply: unknown = {}) => {
  const request = vi.fn(async () => reply);
  return { request, api: createReceivingApi({ request } as unknown as ApiClient) };
};

describe("receiving api", () => {
  it("asks the server for the SENT and RECEIVING orders at this location, soonest first", async () => {
    const { api, request } = make([]);
    await api.queue("L1");
    const [method, path] = request.mock.calls[0] as unknown as [string, string];
    expect(method).toBe("GET");
    const url = new URL(path, "http://x");
    expect(url.pathname).toBe("/api/inventory/purchase-orders");
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: "SENT,RECEIVING", sort: "expected", limit: "100", storeLocationId: "L1" });
  });

  it("starts a session with the order and its own location", async () => {
    const { api, request } = make();
    await api.startSession("P1", "L1");
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/receiving/sessions", { body: { poId: "P1", storeLocationId: "L1" } });
  });

  it("returns the line the server saved", async () => {
    const { api, request } = make({ line: { receivingLineId: "r1", status: "SHORT" }, discrepancy: {} });
    const line = await api.actionLine("S1", "r1", { status: "SHORT", receivedQty: "2" });
    expect(line.status).toBe("SHORT");
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/receiving/sessions/S1/lines/r1", { body: { status: "SHORT", receivedQty: "2" } });
  });

  it("confirms and cancels by session", async () => {
    const { api, request } = make({ poStatus: "RECEIVED" });
    await api.confirm("S1");
    await api.cancel("S1");
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/receiving/sessions/S1/confirm");
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/receiving/sessions/S1/cancel");
  });
});

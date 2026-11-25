import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { createBrainApi } from "./brainApi";

function setup() {
  const request = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ optIn: true }));
  return { request, api: createBrainApi({ request } as unknown as ApiClient) };
}

describe("brain api", () => {
  it("asks for one page of one tier, with the web's filters only when they are set", async () => {
    const { api, request } = setup();
    await api.list({ scope: "user", sourceType: null, search: "  " }, 0, 20);
    expect(request.mock.calls[0].slice(0, 2)).toEqual(["GET", "/api/brain/memories?scope=user&limit=20&offset=0"]);
    await api.list({ scope: "org", sourceType: "waste", search: " salt & oil " }, 40, 20);
    expect(request.mock.calls[1][1]).toBe("/api/brain/memories?scope=org&limit=20&offset=40&sourceType=waste&search=salt%20%26%20oil");
  });

  it("removes a memory and reads and sets the nudges switch", async () => {
    const { api, request } = setup();
    await api.remove("m/1");
    expect(request.mock.calls[0]).toEqual(["DELETE", "/api/brain/memories/m%2F1"]);
    expect(await api.nudges()).toBe(true);
    request.mockResolvedValueOnce({ optIn: false });
    expect(await api.setNudges(false)).toBe(false);
    expect(request.mock.calls[2].slice(0, 2)).toEqual(["PUT", "/api/brain/nudges/opt-in"]);
    expect(request.mock.calls[2][2]).toMatchObject({ body: { optIn: false } });
  });
});

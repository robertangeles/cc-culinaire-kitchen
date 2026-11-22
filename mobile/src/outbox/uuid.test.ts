import { describe, it, expect, afterEach, vi } from "vitest";
import { newUuid } from "./uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("newUuid", () => {
  it("uses the platform's own when it has one", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
    expect(newUuid()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("builds a version 4 id from random bytes when the platform has only getRandomValues", () => {
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => a.fill(255) });
    expect(newUuid()).toMatch(V4);
  });

  it("still gives a valid, different id each time on a runtime with neither (the server only needs it to be a uuid nobody else holds)", () => {
    vi.stubGlobal("crypto", undefined);
    const ids = new Set(Array.from({ length: 200 }, newUuid));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(V4);
  });
});

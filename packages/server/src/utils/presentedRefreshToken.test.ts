import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { presentedRefreshToken } from "./presentedRefreshToken.js";

const req = (cookies: unknown, body: unknown) => ({ cookies, body }) as unknown as Request;

describe("presentedRefreshToken", () => {
  it("uses the cookie when there is one", () => {
    expect(presentedRefreshToken(req({ refresh_token: "c" }, { refreshToken: "b" }))).toBe("c");
  });
  it("falls back to the body for a bearer client with no cookie", () => {
    expect(presentedRefreshToken(req({}, { refreshToken: "b" }))).toBe("b");
    expect(presentedRefreshToken(req(undefined, { refreshToken: "b" }))).toBe("b");
  });
  it("ignores a body token that is not a string", () => {
    expect(presentedRefreshToken(req({}, { refreshToken: { $ne: "" } }))).toBeUndefined();
    expect(presentedRefreshToken(req({}, { refreshToken: 5 }))).toBeUndefined();
  });
  it("returns undefined when neither is present", () => {
    expect(presentedRefreshToken(req(undefined, undefined))).toBeUndefined();
  });
});

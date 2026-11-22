import { describe, it, expect } from "vitest";
import { extractHandshakeToken } from "./socketAuth.js";

describe("extractHandshakeToken", () => {
  it("reads the token a native client puts in the handshake auth payload", () => {
    expect(extractHandshakeToken({ auth: { token: "T" }, headers: {} })).toBe("T");
  });

  it("reads a Bearer Authorization header", () => {
    expect(extractHandshakeToken({ auth: {}, headers: { authorization: "Bearer T" } })).toBe("T");
  });

  it("reads the web client's access_token cookie", () => {
    expect(extractHandshakeToken({ auth: {}, headers: { cookie: "a=1; access_token=T; b=2" } })).toBe("T");
  });

  it("prefers the handshake auth token over the cookie", () => {
    expect(extractHandshakeToken({ auth: { token: "A" }, headers: { cookie: "access_token=C" } })).toBe("A");
  });

  it("returns null when there is none, or the auth token is not a string", () => {
    expect(extractHandshakeToken({ auth: {}, headers: {} })).toBeNull();
    expect(extractHandshakeToken({ auth: { token: 5 }, headers: {} })).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { computeLandingRoute } from "./landing.js";
import type { AuthUser } from "../context/AuthContext.js";

function makeUser(partial: Partial<AuthUser>): AuthUser {
  return {
    userId: 1,
    userName: "Test",
    userEmail: "t@t.com",
    emailVerified: true,
    mfaEnabled: false,
    userPhotoPath: null,
    freeSessions: 0,
    subscriptionStatus: "active",
    subscriptionTier: "free",
    userStatus: "active",
    roles: [],
    permissions: [],
    ...partial,
  };
}

describe("computeLandingRoute", () => {
  it("falls back to chat when there is no user", () => {
    expect(computeLandingRoute(null)).toBe("/chat/new");
    expect(computeLandingRoute(undefined)).toBe("/chat/new");
  });

  it("sends anyone with menu:read to Menu & Costing (Administrator)", () => {
    const admin = makeUser({ roles: ["Administrator"], permissions: ["menu:read"] });
    expect(computeLandingRoute(admin)).toBe("/menu-intelligence");
  });

  it("is permission-driven, not role-name driven — a custom manager role lands on Menu", () => {
    const owner = makeUser({ roles: ["Owner"], permissions: ["menu:read", "prep:manage"] });
    expect(computeLandingRoute(owner)).toBe("/menu-intelligence");
  });

  it("sends an Administrator to Menu & Costing even with no explicit permissions (superuser bypass)", () => {
    const admin = makeUser({ roles: ["Administrator"], permissions: [] });
    expect(computeLandingRoute(admin)).toBe("/menu-intelligence");
  });

  it("keeps a non-admin without menu:read on chat (no 403 bounce)", () => {
    const sub = makeUser({ roles: ["Subscriber"], permissions: ["chat:access"] });
    expect(computeLandingRoute(sub)).toBe("/chat/new");
  });

  it("sends a line cook (prep only, no menu:read) to chat", () => {
    const cook = makeUser({ roles: ["Line Cook"], permissions: ["prep:manage"] });
    expect(computeLandingRoute(cook)).toBe("/chat/new");
  });
});

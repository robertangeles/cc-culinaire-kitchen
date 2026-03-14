import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Mock the db module
vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  user: {
    userId: "user_id",
    freeSessions: "free_sessions",
    subscriptionStatus: "subscription_status",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ field: a, value: b })),
}));

import { checkUsageLimit, decrementFreeSessions } from "./usage.js";
import { db } from "../db/index.js";

function mockReq(user?: { sub: number }): Request {
  return { user } as unknown as Request;
}

function mockRes(): Response & { _status: number; _body: any } {
  const res = {
    _status: 0,
    _body: null,
    status: vi.fn(function (this: any, s: number) {
      this._status = s;
      return this;
    }),
    json: vi.fn(function (this: any, b: any) {
      this._body = b;
      return this;
    }),
  } as unknown as Response & { _status: number; _body: any };
  return res;
}

function chainedSelect(rows: any[]) {
  const chain = {
    from: vi.fn(() => ({
      where: vi.fn(() => rows),
    })),
  };
  vi.mocked(db.select).mockReturnValue(chain as any);
}

describe("checkUsageLimit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when no user on request", async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await checkUsageLimit(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() for paid subscribers regardless of session count", async () => {
    chainedSelect([{ freeSessions: 0, subscriptionStatus: "active" }]);

    const req = mockReq({ sub: 1 });
    const res = mockRes();
    const next = vi.fn();

    await checkUsageLimit(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() for free users with remaining sessions", async () => {
    chainedSelect([{ freeSessions: 5, subscriptionStatus: "free" }]);

    const req = mockReq({ sub: 1 });
    const res = mockRes();
    const next = vi.fn();

    await checkUsageLimit(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 with upgradeRequired for free users with 0 sessions", async () => {
    chainedSelect([{ freeSessions: 0, subscriptionStatus: "free" }]);

    const req = mockReq({ sub: 1 });
    const res = mockRes();
    const next = vi.fn();

    await checkUsageLimit(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ upgradeRequired: true }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when user not found in DB", async () => {
    chainedSelect([]);

    const req = mockReq({ sub: 999 });
    const res = mockRes();
    const next = vi.fn();

    await checkUsageLimit(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

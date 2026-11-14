import { describe, it, expect, vi, beforeEach } from "vitest";

const del = vi.hoisted(() => vi.fn());
vi.mock("stripe", () => {
  class StripeInvalidRequestError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  const Stripe: any = vi.fn().mockImplementation(() => ({ customers: { del } }));
  Stripe.errors = { StripeInvalidRequestError };
  return { default: Stripe };
});
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../utils/env.js", () => ({ CLIENT_URL: "http://localhost" }));

import Stripe from "stripe";
import { deleteCustomer } from "./stripeService.js";

// Block body on purpose: a hook that returns the mock makes vitest call it as cleanup.
beforeEach(() => {
  del.mockReset();
});

// Rejects only when the service awaits the call, as the real Stripe client does.
const failWith = (err: Error) =>
  del.mockImplementation(async () => {
    throw err;
  });
const stripeError = (code: string): Error => new (Stripe as any).errors.StripeInvalidRequestError(code);
const outcome = (p: Promise<void>) => p.then(() => "resolved", (e: Error) => `rejected: ${e.message}`);

describe("deleteCustomer", () => {
  it("deletes the customer by id", async () => {
    del.mockResolvedValue({ deleted: true });
    expect(await outcome(deleteCustomer("cus_1"))).toBe("resolved");
    expect(del).toHaveBeenCalledWith("cus_1");
  });

  it("treats a customer Stripe no longer has as done, so a retry is not stuck", async () => {
    failWith(stripeError("resource_missing"));
    expect(await outcome(deleteCustomer("cus_gone"))).toBe("resolved");
  });

  it("propagates any other Stripe failure, so deletion is refused and can be retried", async () => {
    failWith(new Error("stripe down"));
    expect(await outcome(deleteCustomer("cus_1"))).toBe("rejected: stripe down");
    failWith(stripeError("rate_limit"));
    expect(await outcome(deleteCustomer("cus_1"))).toBe("rejected: rate_limit");
  });
});

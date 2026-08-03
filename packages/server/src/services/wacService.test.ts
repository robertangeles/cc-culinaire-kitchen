import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Guards the raw-SQL parameter binding in wacService.recompute().
 *
 * Raw sql`` templates carry no column type information, so Drizzle passes
 * interpolated values straight to the postgres driver. The driver calls
 * Buffer.byteLength() on them, which throws ERR_INVALID_ARG_TYPE on a Date —
 * every delivery receipt 500'd with "The string argument must be of type
 * string ... Received an instance of Date". The typed builder is unaffected,
 * which is why only this one statement broke.
 *
 * These tests inspect what recompute() actually binds, so a future edit that
 * drops a Date back into the template fails here instead of in production.
 */

const executed: unknown[] = [];

vi.mock("../db/index.js", () => ({ db: {} }));

vi.mock("../db/schema.js", () => ({
  locationIngredient: { ingredientId: "ingredient_id", storeLocationId: "store_location_id" },
  fifoBatch: {},
}));

const auditLogMock = vi.fn(async () => undefined);
vi.mock("./auditService.js", () => ({ log: auditLogMock }));

function makeTx() {
  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => undefined) })),
    })),
    execute: vi.fn(async (statement: unknown) => {
      executed.push(statement);
      return [];
    }),
  };
}

/**
 * Pull every bound value out of a Drizzle SQL object. A sql`` template is a
 * list of queryChunks: StringChunk for the literal SQL text, a nested SQL for
 * an embedded template, and the raw interpolated value for everything else —
 * which is exactly where a stray Date would show up.
 */
function boundParams(statement: any): unknown[] {
  const out: unknown[] = [];
  const walk = (node: any) => {
    if (node == null) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (Array.isArray(node?.queryChunks)) return node.queryChunks.forEach(walk);
    // Literal SQL text carries no bound value.
    if (node?.constructor?.name === "StringChunk") return;
    // Drizzle Param nodes carry the value on `.value`; plain interpolations
    // arrive as the value itself.
    out.push(typeof node === "object" && "value" in node ? node.value : node);
  };
  walk(statement);
  return out;
}

beforeEach(() => {
  executed.length = 0;
  auditLogMock.mockClear();
});

describe("wacService.recompute — raw SQL binding", () => {
  const input = {
    pairs: [{ storeLocationId: "loc-1", ingredientId: "ing-1" }],
    actorUserId: 42,
    organisationId: 7,
    trigger: "receiving" as const,
    triggerEntityId: "sess-1",
  };

  it("never binds a Date into a raw sql template", async () => {
    const { recompute } = await import("./wacService.js");
    await recompute(input, makeTx() as never);

    expect(executed.length).toBeGreaterThan(0);
    const dates = executed.flatMap(boundParams).filter((v) => v instanceof Date);
    expect(dates).toEqual([]);
  });

  it("binds the recompute timestamp as an ISO 8601 string", async () => {
    const { recompute } = await import("./wacService.js");
    const result = await recompute(input, makeTx() as never);

    const iso = executed
      .flatMap(boundParams)
      .filter((v): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v));

    expect(iso.length).toBeGreaterThan(0);
    // The value bound to SQL must be the same instant the caller is told about.
    expect(iso).toContain(result.updatedAt.toISOString());
  });

  it("short-circuits without touching the database when there are no pairs", async () => {
    const { recompute } = await import("./wacService.js");
    const tx = makeTx();
    const result = await recompute({ ...input, pairs: [] }, tx as never);

    expect(result.recomputed).toBe(0);
    expect(tx.execute).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
  });
});

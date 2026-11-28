import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReceiving } from "./useReceiving.js";

/**
 * The start-session response is { session, lines, resumed, startedBy } with no discrepancies array.
 * Rejecting or shorting a line straight after starting must not crash on the missing array.
 */

const discrepancy = { receivingLineId: "rl-1", discrepancyType: "REJECTED" };

describe("useReceiving actionLine", () => {
  it("records the discrepancy when the line is rejected right after the session starts", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const json = (data: unknown) => ({ ok: true, json: async () => data });
      if (url.endsWith("/receiving/sessions")) {
        return json({
          session: { sessionId: "s-1", poId: "po-1", startedAt: "2026-11-28T03:00:00.000Z", docketNumber: null },
          lines: [{ receivingLineId: "rl-1", status: "PENDING", receivedQty: "0", actualUnitCost: "2" }],
          resumed: false,
          startedBy: null,
        });
      }
      return json({ line: { receivingLineId: "rl-1", status: "REJECTED" }, discrepancy });
    }));

    const { result } = renderHook(() => useReceiving());
    await act(() => result.current.startSession("po-1", "loc-1"));
    await act(() => result.current.actionLine("rl-1", { status: "REJECTED" } as never));

    expect(result.current.sessionData?.discrepancies).toEqual([discrepancy]);
  });
});

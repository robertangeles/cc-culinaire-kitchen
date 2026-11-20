import { describe, it, expect, vi } from "vitest";
import { createSendSaveLine } from "./sendSaveLine";
import type { ApiClient } from "../api/client";
import type { OutboxEntry } from "./outbox";

describe("send a queued count", () => {
  it("posts it to the area's lines route with the claim it was made under", async () => {
    const request = vi.fn(async () => undefined);
    const entry = { command: { sessionId: "S1", categoryName: "Stock Room/Back", ingredientId: "i1", ingredientName: "Shiraz", rawQty: 2.5, countedUnit: "kg", claimRevision: 4 } } as OutboxEntry;
    await createSendSaveLine({ request } as unknown as ApiClient)(entry);
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/stock-takes/S1/categories/Stock%20Room%2FBack/lines", {
      body: { ingredientId: "i1", rawQty: 2.5, countedUnit: "kg", claimRevision: 4 },
    });
  });
});

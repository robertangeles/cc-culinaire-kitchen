import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecordSaleModal } from "./RecordSaleModal.js";

/** Sales history: only the person who recorded a sale, or an organisation admin, may void it (the server's `canManage`). */
const sale = (saleId: string, menuItemName: string, canManage: boolean) =>
  ({ saleId, menuItemName, qtySold: "1.000", source: "MANUAL", soldAt: "2026-11-20T12:00:00.000Z", voidedAt: null, canManage });

function serve(voidStatus: number, voidBody: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && String(url).includes("/void")) return new Response(JSON.stringify(voidBody), { status: voidStatus });
    if (String(url).includes("/sales")) return new Response(JSON.stringify([sale("s-chef", "Chef's sale", false), sale("s-mine", "My sale", true)]), { status: 200 });
    return new Response("[]", { status: 200 });
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("RecordSaleModal history", () => {
  const open = async () => {
    render(<RecordSaleModal items={[]} locationId="loc-1" onClose={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "history" }));
    await screen.findByText(/Chef's sale/);
  };

  it("offers void only on the sales the person may void", async () => {
    serve(200, { saleId: "s-mine", restored: 1 });
    await open();
    expect(screen.getAllByRole("button", { name: /void/ })).toHaveLength(1);
  });

  it("shows the server's reason when a void is refused", async () => {
    serve(403, { error: "Only the person who recorded this sale or an organisation admin can void it", code: "FORBIDDEN" });
    await open();
    fireEvent.click(screen.getByRole("button", { name: /void/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the person who recorded this sale");
  });
});

import { describe, it, expect, vi } from "vitest";
import type { Availability } from "@culinaire/shared/schemas/roster";
import { ApiError } from "../api/client";
import { UnsureError } from "../api/onlineWrite";
import { createAvailabilityStore } from "./availabilityStore";
import { memoryCache } from "../../testing/mocks";
import { byWeek, datesText, readForm, windowText, type AvailabilityWindow } from "./availabilityView";

const monday: AvailabilityWindow = { storeLocationId: null, dayOfWeek: 1, availableFrom: "09:00", availableUntil: "17:00", effectiveFrom: "2026-11-26", effectiveUntil: null };
const saved = (over: Partial<Availability> = {}): Availability => ({ staffAvailabilityId: "v1", ...monday, ...over });

describe("the availability form", () => {
  const form = { day: "Monday", from: "09:00", until: "17:00", startsOn: "26/11/2026", endsOn: "" };

  it("reads a window", () => {
    expect(readForm(form, null, [])).toEqual({ window: monday });
    expect(readForm({ ...form, day: "Sunday", endsOn: "31/12/2026" }, "L1", [])).toEqual({ window: { ...monday, storeLocationId: "L1", dayOfWeek: 0, effectiveUntil: "2026-12-31" } });
  });

  it("refuses on the phone what the server would refuse", () => {
    const error = (over: Partial<typeof form>) => (readForm({ ...form, ...over }, null, []) as { error: string }).error;
    expect(error({ from: "9:00" })).toMatch(/24-hour times/);
    expect(error({ until: "09:00" })).toMatch(/must be after/);
    expect(error({ from: "22:00", until: "02:00" })).toMatch(/past midnight/);
    expect(error({ startsOn: "31/02/2026" })).toMatch(/first day/);
    expect(error({ endsOn: "1/1" })).toMatch(/last day/);
    expect(error({ endsOn: "25/11/2026" })).toMatch(/before the first/);
  });

  it("refuses a window the person already has (one row per exact window, migration 0005), and allows a different one the same day", () => {
    expect(readForm(form, null, [monday])).toEqual({ error: "You already have this availability." });
    expect(readForm({ ...form, from: "18:00", until: "22:00" }, null, [monday])).toHaveProperty("window");
    expect(readForm(form, null, [{ ...monday, effectiveUntil: "2026-12-31" }])).toHaveProperty("window");
  });

  it("says it in words, Monday first", () => {
    expect([windowText(monday), datesText({ ...monday, effectiveUntil: "2026-12-31" })]).toEqual(["Monday 09:00–17:00", "From 26 November 2026 to 31 December 2026"]);
    expect([{ ...monday, dayOfWeek: 0 }, { ...monday, availableFrom: "12:00" }, monday].sort(byWeek).map(windowText)).toEqual(["Monday 09:00–17:00", "Monday 12:00–17:00", "Sunday 09:00–17:00"]);
  });
});

describe("availability is online, and safe to repeat", () => {
  async function setup(rows: Availability[] = []) {
    const server = { rows };
    const api = { availability: vi.fn(async () => server.rows), addAvailability: vi.fn(async () => {}), changeAvailability: vi.fn(async () => {}), removeAvailability: vi.fn(async () => {}) };
    const store = createAvailabilityStore(api);
    await store.refresh();
    return { server, api, store, rows: () => store.getSnapshot().rows };
  }

  it("shows the server's row once it is saved", async () => {
    const t = await setup();
    t.api.addAvailability.mockImplementationOnce(async () => void (t.server.rows = [saved()]));
    await t.store.add(monday);
    expect(t.rows()).toMatchObject([{ staffAvailabilityId: "v1" }]);
  });

  it("counts a lost reply as done only when the server holds it, and says when it cannot tell", async () => {
    const landed = await setup();
    landed.api.addAvailability.mockImplementationOnce(async () => {
      landed.server.rows = [saved()];
      throw new ApiError("timeout");
    });
    await expect(landed.store.add(monday)).resolves.toBeUndefined();
    const lost = await setup();
    lost.api.addAvailability.mockRejectedValueOnce(new ApiError("network"));
    await expect(lost.store.add(monday)).rejects.toMatchObject({ code: "network" });
    lost.api.addAvailability.mockRejectedValueOnce(new ApiError("timeout"));
    lost.api.availability.mockRejectedValueOnce(new ApiError("network"));
    await expect(lost.store.add(monday)).rejects.toBeInstanceOf(UnsureError);
  });

  it("keeps the server's words when a change would make a twin", async () => {
    const t = await setup([saved()]);
    t.api.changeAvailability.mockRejectedValueOnce(new ApiError("conflict", "You already have this availability window.", 409, undefined, "CONFLICT"));
    await expect(t.store.change("v1", { ...monday, availableFrom: "10:00" })).rejects.toThrow("You already have this availability window.");
    expect(t.rows()[0].availableFrom).toBe("09:00");
  });

  it("counts a removal of a row already gone as done", async () => {
    const t = await setup([saved()]);
    t.api.removeAvailability.mockImplementationOnce(async () => {
      t.server.rows = [];
      throw new ApiError("not_found", "Availability window not found", 404);
    });
    await expect(t.store.remove("v1")).resolves.toBeUndefined();
  });
});

describe("availability saved for a start with no signal", () => {
  it("keeps the last answer, shows it with its time offline, and drops it when the permission goes", async () => {
    const cache = memoryCache();
    const api = { availability: vi.fn(async () => [saved()]), addAvailability: vi.fn(), changeAvailability: vi.fn(), removeAvailability: vi.fn() };
    await createAvailabilityStore(api, cache).refresh();
    expect(cache.write).toHaveBeenCalledWith("availability", "1:L1", [saved()]);
    const offline = createAvailabilityStore(api, cache);
    api.availability.mockRejectedValueOnce(new ApiError("network"));
    await offline.refresh();
    expect(offline.getSnapshot()).toMatchObject({ phase: "ready", rows: [{ staffAvailabilityId: "v1" }], savedAt: "2026-11-25T20:00:00.000Z" });
    api.availability.mockRejectedValueOnce(new ApiError("forbidden", undefined, 403));
    await offline.refresh();
    expect(offline.getSnapshot()).toMatchObject({ phase: "failed", rows: [], savedAt: null });
    expect(cache.rows.size).toBe(0);
  });
});

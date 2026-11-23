import { describe, it, expect, beforeAll, afterAll, beforeEach, onTestFailed } from "vitest";
import { PrepTodaySchema } from "@culinaire/shared/schemas/prep";
import { adb, back, clearApp, clearField, findAll, forceStop, has, hideKeyboard, openApp, screenshot, setAirplane, setAnimations, setFontScale, tap, tapAt, typeInto, waitFor, waitGone } from "./adb";
import { credentials, freshCode, manager } from "./fixtures";
import { localDate } from "../src/prep/prepView";
import { newUuid } from "../src/outbox/uuid";

/**
 * The prep walk on a real Android phone, against the real server: a cook signs in, sees today's list, ticks with no signal,
 * reconnects and sees the tick sent. A manager (the E2E user) makes the list through the API first, as a colleague would.
 * Run it through the lease (`check:device -- device/prep`). Needs the development build, Metro on METRO_URL and the server on
 * E2E_API_URL, with the phone able to reach both (adb reverse): see device/README.md.
 */
const METRO = process.env.METRO_URL ?? "http://localhost:8088";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let m: ReturnType<typeof manager>;
let locationId = "";
let menuItemId = "";
let sessionId = "";
const tag = `pw${Date.now().toString(36).slice(-5)} `;

const serverTasks = async () => {
  const res = await m.client.request("GET", `/api/prep/sessions/today?date=${localDate(new Date())}&storeLocationId=${locationId}`, { schema: { parse: (d: unknown) => PrepTodaySchema.parse(d) } });
  return res.tasks;
};

async function launch() {
  forceStop();
  await openApp(METRO);
  await sleep(6000);
  if (await has("Go home")) await back();
}

async function signIn() {
  await waitFor("Sign in", 60_000);
  await clearField("Email");
  await typeInto("Email", credentials.email);
  await clearField("Password");
  await typeInto("Password", credentials.password);
  await hideKeyboard();
  const labelled = await findAll("Sign in");
  const button = labelled[labelled.length - 1];
  await tapAt(Math.round((button.x1 + button.x2) / 2), Math.round((button.y1 + button.y2) / 2));
  await sleep(2500);
  if (await has("Save password to Google Password Manager?")) await back();
  await waitFor("Enter your 6-digit code", 30_000);
  await clearField("Code");
  await typeInto("Code", await freshCode());
  await hideKeyboard();
  await tap("Verify");
}

describe("prep walk on a device", () => {
  beforeEach((ctx) => {
    onTestFailed(async () => {
      await screenshot(`FAILED-prep-${ctx.task.name.slice(0, 40).replace(/[^a-z0-9]+/gi, "-")}`).catch(() => {});
    });
  });

  beforeAll(async () => {
    adb(["devices"]);
    await setAirplane(false);
    setAnimations(true);
    setFontScale(1.0);
    clearApp();
    m = manager();
    await m.signIn();
    locationId = (await m.client.request<{ selectedLocationId: string }>("GET", "/api/users/location-context")).selectedLocationId;
    const item = await m.client.request<{ menuItemId: string }>("POST", "/api/menu/items", { body: { name: `${tag}Soup`, category: "Starter", sellingPrice: "9.50" } });
    menuItemId = item.menuItemId;
    for (const [name, qty] of [["Onion", "2"], ["Carrot", "1.5"]]) await m.client.request("POST", `/api/menu/items/${menuItemId}/ingredients`, { body: { ingredientName: `${tag}${name}`, quantity: qty, unit: "kg" } });
    sessionId = newUuid();
    await m.client.request("POST", "/api/prep/sessions", { body: { prepSessionId: sessionId, prepDate: localDate(new Date()), storeLocationId: locationId, expectedCovers: 60 } });
    await m.client.request("POST", `/api/prep/sessions/${sessionId}/selections`, { body: { selections: [{ menuItemId, dishName: `${tag}Soup`, expectedPortions: 10 }] } });
    await m.client.request("POST", `/api/prep/sessions/${sessionId}/generate`, { body: { requestId: newUuid() } });
    await launch();
  });

  afterAll(async () => {
    await setAirplane(false);
    await m.client.request("PATCH", `/api/prep/sessions/${sessionId}/end`, { body: {} }).catch(() => {});
    await m.client.request("DELETE", `/api/menu/items/${menuItemId}`).catch(() => {});
  });

  it("P1 signs in and opens the Prep tab, which shows the list the manager made", async () => {
    await signIn();
    await waitFor(/Prep$/, 60_000);
    const tabs = await findAll("Prep");
    const tab = tabs[tabs.length - 1]; // the tab bar is the lowest "Prep"
    await tapAt(Math.round((tab.x1 + tab.x2) / 2), Math.round((tab.y1 + tab.y2) / 2));
    await waitFor(new RegExp(`${tag}Onion, 2 kg`), 40_000);
    await waitFor("0 of 2 done", 10_000);
    await screenshot("p01-prep-list");
  });

  it("P2 a tick with no signal shows at once as done and waiting, and the server has not heard of it", async () => {
    await setAirplane(true);
    await tap(new RegExp(`${tag}Onion, 2 kg`));
    await waitFor("1 of 2 done", 10_000);
    await waitFor("Waiting to send", 10_000);
    await screenshot("p02-offline-tick");
    expect((await serverTasks()).find((t) => t.ingredientName === `${tag}Onion`)!.status).toBe("pending");
  });

  it("P3 on reconnect the tick is sent with the cook's id, and the row is no longer waiting", async () => {
    await setAirplane(false);
    await waitGone("Waiting to send", 120_000);
    const onion = (await serverTasks()).find((t) => t.ingredientName === `${tag}Onion`)!;
    expect(onion.status).toBe("completed");
    expect(onion.completedBy).not.toBeNull();
    await screenshot("p03-synced");
  });

  it("P4 the list survives the app being killed and reopened with no signal", async () => {
    await setAirplane(true);
    await launch();
    await waitFor(new RegExp(`${tag}Onion, 2 kg`), 60_000);
    await waitFor("1 of 2 done", 10_000);
    await screenshot("p04-offline-reopen");
    await setAirplane(false);
  });
});

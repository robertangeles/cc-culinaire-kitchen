import { describe, it, expect, beforeAll, afterAll, beforeEach, onTestFailed } from "vitest";
import {
  adb, back, clearApp, tap, tapAt, tapLabel, clearField, find, findAll, has, hideKeyboard, openApp, openTab, forceStop, screenshot, setAirplane, setAnimations, setDarkMode, setFontScale,
  setRotation, typeInto, waitFor, waitGone, screenSize,
} from "./adb";
import { credentials, freshCode, manager } from "./fixtures";

/**
 * The usage log and the moves between areas on a real Android runtime, driven through the app's own screens against the real
 * server: log usage with signal and with airplane mode on (it waits, then is sent), the "that's a move, not usage" question,
 * record a move, and look at both screens in landscape (the width of a small tablet). Each step saves a screenshot to device/_shots.
 * Needs: the development build installed, Metro on METRO_URL, the server on E2E_API_URL, `adb reverse` for both, and the E2E user.
 */
const METRO = process.env.METRO_URL ?? "http://localhost:8088";
const API = "/api/inventory";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const m = manager();
let tag = "";
let itemName = "";
let itemId = "";
let locationId = "";
const areaIds: string[] = [];
const areaNames = { a: "", b: "" };

async function launch() {
  forceStop();
  await openApp(METRO);
  await sleep(6000);
  if (await has("Go home")) await back();
}

async function signIn() {
  await waitFor("Sign in", 240_000);
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

/** The tab with this title (a tab is "Usage, tab, 3 of 5" or similar); the E2E user is an Administrator, so Move and Account are under More. */
const tab = (title: string) => openTab(title);

describe("usage and moves on a device", () => {
  beforeEach((ctx) => {
    onTestFailed(async () => {
      await screenshot(`FAILED-${ctx.task.name.slice(0, 40).replace(/[^a-z0-9]+/gi, "-")}`).catch(() => {});
    });
  });

  beforeAll(async () => {
    adb(["devices"]);
    adb(["reverse", "tcp:8088", "tcp:8088"]);
    await setAirplane(false);
    setAnimations(true);
    setFontScale(1.0);
    setDarkMode(false);
    await setRotation(false);
    clearApp();
    await m.signIn();
    tag = `sw${Date.now().toString(36).slice(-5)} `;
    locationId = (await m.client.request<{ selectedLocationId: string }>("GET", "/api/users/location-context")).selectedLocationId;
    itemName = `${tag}Walk Salt`;
    itemId = (await m.client.request<{ ingredientId: string }>("POST", `${API}/ingredients`, { body: { ingredientName: itemName, ingredientCategory: "dry_goods", baseUnit: "kg", unitCost: "1.00" } })).ingredientId;
    for (const [key, name, sortOrder] of [["a", "Stock Room", 980], ["b", "Back Bar", 981]] as const) {
      areaNames[key] = `${tag}${name}`;
      areaIds.push((await m.client.request<{ storageAreaId: string }>("POST", `${API}/locations/${locationId}/storage-areas`, { body: { areaName: areaNames[key], sortOrder } })).storageAreaId);
    }
    await launch();
  });

  afterAll(async () => {
    await setAirplane(false);
    setFontScale(1.0);
    setDarkMode(false);
    await setRotation(false);
    const logs = await m.client.request<Array<{ consumptionLogId: string; ingredientId: string }>>("GET", `${API}/consumption-logs?storeLocationId=${locationId}&limit=200`).catch(() => []);
    for (const l of logs.filter((x) => x.ingredientId === itemId)) await m.client.request("DELETE", `${API}/consumption-logs/${l.consumptionLogId}`).catch(() => {});
    for (const id of areaIds) await m.client.request("DELETE", `${API}/storage-areas/${id}`).catch(() => {});
    await m.client.request("DELETE", `${API}/ingredients/${itemId}`).catch(() => {});
  });

  it("S1 signs in and shows Prep, Waste, Usage and Count with Move and Account under More", async () => {
    await signIn();
    await waitFor(/^Usage(,|$)/, 60_000);
    for (const t of ["Prep", "Waste", "Usage", "Count", "More"]) expect(await has(new RegExp(`^${t}(,|$)`)), `${t} tab`).toBe(true);
    await screenshot("s01-tabs");
  });

  it("S2 logs usage with signal: the entry is on the list and on the server", async () => {
    await tab("Usage");
    await waitFor("Internal usage", 20_000);
    await screenshot("s02-usage-empty");
    await tap("Log usage");
    await waitFor("What was used", 20_000);
    await typeInto("What was used", `${tag}Walk`.trim());
    await tap(`Use ${itemName}`, 30_000);
    await typeInto("How much", "2.5");
    await hideKeyboard();
    await tapLabel("Kitchen");
    await screenshot("s02-usage-form");
    await tap("Log usage");
    await waitFor(/Walk Salt, 2.5 kg/, 30_000);
    await screenshot("s02-usage-list");
    await waitGone("1 waiting to send", 60_000);
    const onServer = await m.client.request<Array<{ ingredientId: string; quantity: string }>>("GET", `${API}/consumption-logs?storeLocationId=${locationId}&limit=50`);
    expect(onServer.filter((e) => e.ingredientId === itemId).map((e) => Number(e.quantity))).toEqual([2.5]);
  });

  it("S3 with airplane mode on, a usage entry waits on the phone and is sent when the signal is back", async () => {
    await setAirplane(true);
    await tap("Log usage");
    await waitFor("What was used", 20_000);
    await typeInto("What was used", `${tag}Walk`.trim());
    await tap(`Use ${itemName}`, 30_000);
    await typeInto("How much", "1");
    await hideKeyboard();
    await tapLabel("Staff");
    await tap("Log usage");
    await waitFor("1 waiting to send", 30_000);
    await screenshot("s03-usage-waiting");
    expect((await m.client.request<Array<{ ingredientId: string }>>("GET", `${API}/consumption-logs?storeLocationId=${locationId}&limit=50`)).filter((e) => e.ingredientId === itemId)).toHaveLength(1);
    await setAirplane(false);
    await waitGone("1 waiting to send", 120_000);
    await screenshot("s03-usage-sent");
    expect((await m.client.request<Array<{ ingredientId: string }>>("GET", `${API}/consumption-logs?storeLocationId=${locationId}&limit=50`)).filter((e) => e.ingredientId === itemId)).toHaveLength(2);
  });

  it("S4 asks 'that's a move, not usage' for FOH usage of a kitchen ingredient, and hands the item to Move", async () => {
    await tap("Log usage");
    await waitFor("What was used", 20_000);
    await typeInto("What was used", `${tag}Walk`.trim());
    await tap(`Use ${itemName}`, 30_000);
    await typeInto("How much", "1");
    await hideKeyboard();
    await tapLabel("FOH");
    await tap("Log usage");
    await waitFor("Taking stock to the bar or front of house?", 20_000);
    await screenshot("s04-move-question");
    await tap("Record as movement");
    await waitFor("Record a move", 20_000);
    expect((await find(/^What moved/))?.text ?? "").toContain("Walk Salt");
    await screenshot("s04-move-prefilled");
  });

  it("S5 records a move between two areas, with signal off, and it is sent when the signal is back", async () => {
    await setAirplane(true);
    // Both rows list the areas: From is the upper row, To the lower.
    await tapLabel(areaNames.a);
    const to = (await findAll(areaNames.b)).pop()!;
    await tapAt(Math.round((to.x1 + to.x2) / 2), Math.round((to.y1 + to.y2) / 2));
    await tap("Record move");
    await waitFor(/Walk Salt/, 30_000);
    await waitFor("1 waiting to send", 30_000);
    await screenshot("s05-move-waiting");
    await setAirplane(false);
    await waitGone("1 waiting to send", 120_000);
    await screenshot("s05-move-sent");
    const moves = await m.client.request<Array<{ ingredientId: string; fromAreaName: string; toAreaName: string }>>("GET", `${API}/locations/${locationId}/stock-movements`);
    expect(moves.filter((x) => x.ingredientId === itemId)).toMatchObject([{ fromAreaName: areaNames.a, toAreaName: areaNames.b }]);
  });

  it("S6 changes and deletes an entry from the usage list", async () => {
    await tab("Usage");
    await waitFor("Internal usage", 20_000);
    await tap(/^Walk Salt, 2.5 kg, sent. Edit/);
    await waitFor("Change usage entry", 20_000);
    await clearField("How much");
    await typeInto("How much", "4");
    await hideKeyboard();
    await tap("Save changes");
    await waitFor(/Walk Salt, 4 kg/, 60_000);
    await screenshot("s06-usage-changed");
    await tap(/^Walk Salt, 4 kg/);
    await tap("Delete this entry");
    await tap("Delete");
    await waitGone(/Walk Salt, 4 kg/, 60_000);
    await screenshot("s06-usage-deleted");
  });

  it("S7 both screens read well in landscape, the width of a small tablet", async () => {
    await setRotation(true);
    const [w, h] = screenSize();
    expect(Math.max(w, h)).toBeGreaterThan(2000);
    await tab("Usage");
    await sleep(1500);
    await screenshot("s07-usage-landscape");
    await tab("Move");
    await sleep(1500);
    await screenshot("s07-move-landscape");
    expect(await has("Move between areas")).toBe(true);
    await setRotation(false);
  });
});

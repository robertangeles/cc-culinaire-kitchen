import { describe, it, expect, beforeAll, afterAll, beforeEach, onTestFailed } from "vitest";
import { adb, back, clearField, find, forceStop, has, hideKeyboard, openApp, screenshot, tap, tapAt, tapLabel, typeInto, waitFor, findAll } from "./adb";
import { credentials, freshCode, manager } from "./fixtures";

/**
 * Receiving a delivery on a real Android runtime, through the app's own screens against the real server: sign in,
 * open Receive deliveries, receive one delivery perfectly, then another with a short line, a wrong price and a
 * rejection, and check the server's side. It changes no system setting (no airplane mode, font size or rotation),
 * signs out at the end and removes the adb tunnels it added. Needs the dev build installed, Metro on METRO_URL,
 * and the server on E2E_API_URL; the phone reaches both through `adb reverse`.
 */
const METRO = process.env.METRO_URL ?? "http://localhost:8190";
const API = "/api/inventory";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const tag = `rd${Date.now().toString(36).slice(-5)} `;
const supplierName = `${tag}Fresh Farms`;

const tunnels = [new URL(METRO).port, new URL(process.env.E2E_API_URL ?? "http://localhost:3009").port];
const m = manager();
let locationId = "";
let flourId = "";
let milkId = "";
let beefId = "";
const orders: Record<"perfect" | "mixed", string> = { perfect: "", mixed: "" };

async function sentOrder(supplierId: string, lines: Array<{ ingredientId: string; qty: string; cost: string }>) {
  const po = await m.client.request<{ poId: string }>("POST", `${API}/purchase-orders`, {
    body: { storeLocationId: locationId, supplierId, lines: lines.map((l) => ({ ingredientId: l.ingredientId, orderedQty: l.qty, orderedUnit: "kg", unitCost: l.cost })) },
  });
  await m.client.request("POST", `${API}/purchase-orders/${po.poId}/submit`);
  return po.poId;
}

async function typeDigits(digits: string) {
  for (const d of digits) await tapLabel(d === "." ? "Decimal point" : d === "0" ? "Zero, none here" : d);
}

/** The phone offers to fill the saved password of whoever owns it. Back dismisses the offer without choosing anything. */
async function dismissAutofill() {
  // The offer is a system window over the app, so the screen dump cannot see it: ask which window has focus instead.
  const appHasFocus = () => /mCurrentFocus=.*com\.culinairekitchen\.chef/.test(adb(["shell", "dumpsys", "window"]));
  for (let i = 0; i < 3 && !appHasFocus(); i++) {
    await back();
    await sleep(800);
  }
}

async function signIn() {
  await waitFor("Sign in", 60_000);
  await dismissAutofill();
  await clearField("Email");
  await dismissAutofill();
  await typeInto("Email", credentials.email);
  await dismissAutofill();
  await clearField("Password");
  await dismissAutofill();
  await typeInto("Password", credentials.password);
  await dismissAutofill();
  await hideKeyboard();
  const labelled = await findAll("Sign in");
  const button = labelled[labelled.length - 1];
  await tapAt(Math.round((button.x1 + button.x2) / 2), Math.round((button.y1 + button.y2) / 2));
  await sleep(2500);
  if (await has("Save password to Google Password Manager?")) await back();
  await waitFor("Enter your 6-digit code", 30_000);
  const code = await freshCode();
  await clearField("Code");
  await typeInto("Code", code);
  await hideKeyboard();
  await tap("Verify");
}

describe("receiving walk on a device", () => {
  beforeEach((ctx) => {
    onTestFailed(async () => {
      await screenshot(`FAILED-${ctx.task.name.slice(0, 40).replace(/[^a-z0-9]+/gi, "-")}`).catch(() => {});
    });
  });

  beforeAll(async () => {
    for (const port of tunnels) adb(["reverse", `tcp:${port}`, `tcp:${port}`]);
    await m.signIn();
    locationId = (await m.client.request<{ selectedLocationId: string }>("GET", "/api/users/location-context")).selectedLocationId;
    const supplierId = (await m.client.request<{ supplierId: string }>("POST", `${API}/suppliers`, { body: { supplierName, contactPhone: "0400 111 222" } })).supplierId;
    const mk = async (name: string) => (await m.client.request<{ ingredientId: string }>("POST", `${API}/ingredients`, { body: { ingredientName: `${tag}${name}`, ingredientCategory: "produce", baseUnit: "kg", unitCost: "2.00" } })).ingredientId;
    flourId = await mk("Flour");
    milkId = await mk("Milk");
    beefId = await mk("Beef");
    orders.perfect = await sentOrder(supplierId, [{ ingredientId: flourId, qty: "3", cost: "2" }]);
    orders.mixed = await sentOrder(supplierId, [{ ingredientId: flourId, qty: "10", cost: "2" }, { ingredientId: milkId, qty: "4", cost: "1.5" }, { ingredientId: beefId, qty: "2", cost: "9" }]);
    forceStop();
    await openApp(METRO);
    await sleep(6000);
    if (await has("Go home")) await back();
  });

  afterAll(async () => {
    // Leave the phone as it was found: signed out, and without the tunnels this run added.
    if (await has("Sign out")) await tap("Sign out").catch(() => {});
    for (const port of tunnels) adb(["reverse", "--remove", `tcp:${port}`]);
  });

  it("R1 signs in and offers Receive deliveries on the home screen", async () => {
    await signIn();
    await waitFor("Receive deliveries", 60_000);
    await screenshot("r01-home");
  });

  it("R2 the deliveries queue lists the sent orders, with the supplier and item count", async () => {
    await tap("Receive deliveries");
    await waitFor(new RegExp(`^${supplierName}, order .*, 3 items`), 30_000);
    expect(await has(new RegExp(`^${supplierName}, order .*, 1 item`))).toBe(true);
    await screenshot("r02-queue");
  });

  it("R3 a perfect delivery is open, confirm", async () => {
    await tap(new RegExp(`^${supplierName}, order .*, 1 item`));
    await waitFor(new RegExp(`^${tag}Flour, 3 kg, Received`), 30_000);
    await screenshot("r03-checklist");
    await tap("Confirm delivery");
    await waitFor("Delivery received", 30_000);
    await screenshot("r04-received");
    const po = await m.client.request<{ status: string }>("GET", `${API}/purchase-orders/${orders.perfect}`);
    expect(po.status).toBe("RECEIVED");
    await tap("Back to deliveries");
    await waitFor(new RegExp(`^${supplierName}, order .*, 3 items`));
  });

  it("R5 a mixed delivery: short, wrong price and reject, then confirm closes it as partial", async () => {
    await tap(new RegExp(`^${supplierName}, order .*, 3 items`));
    await waitFor(new RegExp(`^${tag}Flour, 10 kg, Received`), 30_000);

    await tap(new RegExp(`^${tag}Flour, 10 kg, Received`));
    await tap("Short");
    await typeDigits("7");
    await screenshot("r05-short-keypad");
    await tap("Mark short");
    await waitFor(new RegExp(`^${tag}Flour, Short: 7 of 10 kg, Short`), 20_000);

    await tap(new RegExp(`^${tag}Milk, 4 kg, Received`));
    await tap("Wrong price");
    await typeDigits("1.8");
    await tap("Save price");
    await waitFor(new RegExp(`^${tag}Milk, 4 kg, price now \\$1.80/kg, Price changed`), 20_000);

    await tap(new RegExp(`^${tag}Beef, 2 kg, Received`));
    await tap("Reject");
    await screenshot("r06-reject");
    await tap("Damaged packaging");
    await tap("Reject item");
    await waitFor(new RegExp(`^${tag}Beef, Rejected: 2 kg, Rejected`), 20_000);

    await screenshot("r07-checklist-issues");
    await tap("Confirm delivery · 3 issues");
    await waitFor("Delivery received, with a shortfall", 30_000);
    await screenshot("r08-shortfall");
    const po = await m.client.request<{ status: string }>("GET", `${API}/purchase-orders/${orders.mixed}`);
    expect(po.status).toBe("PARTIAL_RECEIVED");
    await tap("Back to deliveries");
    // Orders left by earlier runs may still be queued: this run's two must be gone.
    await waitFor("Deliveries", 20_000);
    await sleep(1500);
    expect(await has(new RegExp(`^${supplierName}, order `))).toBe(false);
    await screenshot("r09-queue-after");
    expect(await find(/Unmatched|doesn't exist/i)).toBeUndefined();
  });
});

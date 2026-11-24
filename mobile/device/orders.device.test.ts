import { describe, it, beforeAll, afterAll, onTestFailed, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  adb, back, clearApp, clearField, dismissSavePassword, dump, findAll, forceStop, has, hideKeyboard, openApp, openTab, screenSize, setAnimations, setRotation, swipe, tap, tapAt, typeInto, waitFor,
} from "./adb";
import { credentials, freshCode, manager } from "./fixtures";

/**
 * The purchasing walk: every Orders screen and its main states on a real Android runtime, against a real server, photographed for a person
 * to look at, doing what a manager does on the way (write from a guide, submit, approve, reject, receive short, credit). Run it through
 * `SCREENS_FILE=device/orders.device.test.ts bash device/screens.sh <out-dir>`, which makes the database, the server and Metro; skipped without it.
 */
const METRO = process.env.METRO_URL ?? "http://127.0.0.1:8088";
const OUT = resolve(process.env.SCREENS_OUT ?? "device/_shots/orders", process.env.SCREENS_FORM ?? "phone");
const API = "/api/inventory";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const FARMS = "Fresh Farms";
const LONG = "Harbour City Produce, Seafood and Dry Goods Wholesale";

const m = manager();
let locationId = "";
const ids: Record<string, string> = {};

async function shot(name: string) {
  await sleep(900);
  for (let i = 0; i < 3 && (await dismissSavePassword()); i++);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${name}.png`), execFileSync(process.env.ADB ?? `${process.env.ANDROID_HOME ?? `${process.env.HOME}/Android/Sdk`}/platform-tools/adb`, ["exec-out", "screencap", "-p"], { maxBuffer: 1 << 26 }));
}

/** The throwaway database of this walk only: how long an order has waited, and a second approver, cannot be made through the API. */
function sql(statement: string) {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("postgresql://ci@127.0.0.1:55432/")) throw new Error("the orders walk changes rows only in the local throwaway database");
  execFileSync("psql", [url, "-qc", statement]);
}

const scroll = async (up = false) => {
  const [w, h] = screenSize();
  await swipe(Math.round(w / 2), Math.round(h * (up ? 0.3 : 0.7)), Math.round(w / 2), Math.round(h * (up ? 0.7 : 0.3)), 300);
};
/** Tap a button by its label, scrolling to it. */
async function press(label: string | RegExp) {
  for (let i = 0; i < 9; i++) {
    const [, h] = screenSize();
    const button = (await dump()).find((n) => n.clickable && (typeof label === "string" ? n.desc === label : label.test(n.desc)) && n.y2 < h * 0.93);
    if (button) return tapAt(Math.round((button.x1 + button.x2) / 2), Math.round((button.y1 + button.y2) / 2));
    await hideKeyboard();
    await scroll(i > 5);
  }
  throw new Error(`no button labelled ${String(label)}`);
}
async function type(label: string, text: string) {
  for (let i = 0; i < 4; i++) {
    if ((await findAll(label)).some((n) => n.cls.includes("EditText"))) break;
    await scroll();
  }
  await clearField(label);
  await typeInto(label, text);
  await hideKeyboard();
}

async function launch() {
  forceStop();
  await openApp(METRO);
  await sleep(6000);
}
/** After `pm clear` the dev client opens its menu over the app and shows a floating Tools button: switch the button off and close the menu. */
async function closeDevMenu() {
  for (let i = 0; i < 60 && !(await has("Tools button")) && !(await has("Tools")); i++) await sleep(2000);
  if (!(await has("Tools button"))) await tap("Tools");
  const row = await waitFor("Tools button", 20_000).catch(() => null);
  const [w] = screenSize();
  if (row) await tapAt(Math.round(w * 0.92), Math.round((row.y1 + row.y2) / 2));
  for (let i = 0; i < 3 && (await has("Toggle performance monitor")); i++) await back();
  await sleep(800);
}
async function signIn() {
  clearApp();
  await launch();
  await closeDevMenu();
  await waitFor("Welcome back to the line.", 240_000);
  for (let i = 0; i < 3; i++) {
    await dismissSavePassword();
    await clearField("Email");
    await typeInto("Email", credentials.email);
    await dismissSavePassword();
    await clearField("Password");
    await typeInto("Password", credentials.password);
    await hideKeyboard();
    const all = await findAll("Sign in");
    const b = all[all.length - 1];
    await tapAt(Math.round((b.x1 + b.x2) / 2), Math.round((b.y1 + b.y2) / 2));
    await sleep(4000);
    await dismissSavePassword();
    if (await has("Enter your 6-digit code")) break;
  }
  await waitFor("Enter your 6-digit code", 30_000);
  await clearField("Code");
  await typeInto("Code", await freshCode());
  await hideKeyboard();
  if (await has("Verify")) await tap("Verify");
  await waitFor(/^More(,|$)|^Account(,|$)/, 60_000);
}
const ordersHome = async () => {
  await openTab("Orders");
  for (let i = 0; i < 5 && !(await has("New order")) && !(await has(/^Continue your order/)); i++) await back();
};

describe.skipIf(!process.env.SCREENS_OUT)("purchasing walk", { timeout: 600_000 }, () => {
  beforeEach((ctx) => {
    onTestFailed(async ({ task }) => {
      process.stderr.write(`FAILED ${task.name}: ${task.result?.errors?.[0]?.message ?? "?"}\n`);
      await shot(`FAILED-${ctx.task.name.slice(0, 40).replace(/[^a-z0-9]+/gi, "-")}`).catch(() => {});
    });
  });

  beforeAll(async () => {
    for (const url of [METRO, process.env.E2E_API_URL!]) adb(["reverse", `tcp:${new URL(url).port}`, `tcp:${new URL(url).port}`]);
    setAnimations(false);
    await setRotation(false);
    await m.signIn();
    locationId = (await m.client.request<{ selectedLocationId: string }>("GET", "/api/users/location-context")).selectedLocationId;
    const post = <T>(path: string, body: unknown) => m.client.request<T>("POST", `${API}${path}`, { body });
    for (const [key, name] of [["farms", FARMS], ["long", LONG]]) ids[key] = (await post<{ supplierId: string }>("/suppliers", { supplierName: name, contactPhone: "0400 111 222", orderingMethod: "email" })).supplierId;
    for (const [key, name, extra] of [
      ["flour", "Plain flour", { unitCost: "1.40", purchaseUnit: "bag", packQty: "12.5", parLevel: "25" }],
      ["oil", "Extra virgin olive oil, first cold press, unfiltered", { baseUnit: "L", unitCost: "9.60", purchaseUnit: "tin", packQty: "4", parLevel: "12" }],
      ["salt", "Sea salt flakes", { unitCost: "4.20", parLevel: "2" }],
    ] as const) ids[key] = (await post<{ ingredientId: string }>("/ingredients", { ingredientName: name, ingredientCategory: "dry_goods", baseUnit: "kg", ...extra })).ingredientId;
    await post(`/locations/${locationId}/activate-items`, { ingredientIds: [ids.flour, ids.oil, ids.salt] });
    const guide = await post<{ orderGuideId: string }>(`/locations/${locationId}/order-guides`, { name: "Weekly dry store", supplierId: ids.farms });
    await m.client.request("PUT", `${API}/order-guides/${guide.orderGuideId}/items`, { body: { items: [ids.flour, ids.oil, ids.salt].map((ingredientId) => ({ ingredientId })) } });
    await m.client.request("PUT", `${API}/thresholds/location`, { body: { storeLocationId: locationId, amount: 200 } });
  });
  afterAll(async () => {
    await setRotation(false);
    setAnimations(true);
  });

  const make = async (supplier: string, lines: Array<[string, string, string, string]>, then?: "submit") => {
    const po = await m.client.request<{ poId: string }>("POST", `${API}/purchase-orders`, {
      body: { storeLocationId: locationId, supplierId: ids[supplier], expectedDeliveryDate: "2030-05-06", notes: "Back door, before 9 am", lines: lines.map(([item, orderedQty, orderedUnit, unitCost]) => ({ ingredientId: ids[item], orderedQty, orderedUnit, unitCost })) },
    });
    if (then) await m.client.request("POST", `${API}/purchase-orders/${po.poId}/submit`);
    return po.poId;
  };

  it("with nothing yet, then an order written from a guide and submitted", async () => {
    await signIn();
    await ordersHome();
    await waitFor("No orders yet", 30_000);
    await shot("o01-orders-empty");
    await press("New order");
    await waitFor("Start from a guide", 30_000);
    await shot("o02-new-order");
    await press(/^Use the guide Weekly dry store/);
    await waitFor(/^Plain flour, 2 bag/, 30_000);
    await shot("o03-new-order-guide");
    await press(/^Plain flour, 2 bag/);
    await waitFor("Price per bag");
    await shot("o04-new-order-line");
    await type("Order", "3");
    await shot("o04b-new-order-keyboard-closed");
    await scroll();
    await scroll();
    await shot("o05-new-order-foot");
    await press("Save as draft");
    await waitFor("Submit order", 30_000);
    await shot("o06-order-draft");
    await press("Change order");
    await waitFor("Change order", 30_000);
    await waitFor(/^Plain flour, 3 bag/, 30_000);
    await shot("o07-change-order");
    await press("Save changes");
    await waitFor("Submit order", 30_000);
    await press("Submit order");
    await waitFor(/^Order submitted|^This order needs approval/, 30_000);
    await shot("o08-order-submitted");
  });

  it("the list, filters and the approvals queue", async () => {
    const big = await make("long", [["flour", "12", "bag", "17.50"], ["oil", "4", "tin", "38.40"]], "submit");
    const mine = await make("farms", [["oil", "8", "tin", "38.40"]], "submit");
    const draft = await make("farms", [["salt", "2", "kg", "4.20"]]);
    const sent = await make("farms", [["flour", "4", "bag", "17.50"]], "submit");
    await m.client.request("POST", `${API}/purchase-orders/${await make("long", [["salt", "1", "kg", "4.20"]])}/cancel`);
    sql(`update purchase_order set submitted_at = now() - interval '52 hours' where po_id = '${big}'`);
    sql(`update purchase_order set submitted_at = now() - interval '30 hours' where po_id = '${mine}'`);
    Object.assign(ids, { big, mine, draft, sent });
    await ordersHome();
    await scroll(true);
    await waitFor(/^Approvals, /, 30_000);
    await sleep(1500);
    await shot("o10-orders");
    await scroll();
    await shot("o11-orders-scrolled");
    await scroll(true);
    await scroll(true);
    await press("Approvals, 2 waiting");
    await waitFor(/Waiting 52 h/, 30_000);
    await shot("o12-approvals");
    await press(new RegExp(`^${LONG.slice(0, 12)}`));
    await waitFor("Approve", 30_000);
    await shot("o13-order-pending");
    await press("Reject");
    await waitFor("Why is it not approved?");
    await scroll();
    await shot("o14-reject");
    await type("Why is it not approved?", "Twelve bags is too much before the holiday");
    await press("Reject order");
    await waitFor("Not approved", 30_000);
    await scroll(true);
    await shot("o15-order-rejected");
    await back();
    await back();
  });

  it("an approver's own order while someone else can approve, then approved", async () => {
    const org = `(select organisation_id from store_location where store_location_id = '${locationId}')`;
    const phone = `(select user_id from "user" where user_name = 'E2E Phone User')`;
    sql(`update user_organisation set organisation_id = ${org} where user_id = ${phone}`);
    const alone = () => sql(`update user_organisation set organisation_id = (select organisation_id from organisation where organisation_name = 'E2E Phone Kitchen') where user_id = ${phone}`);
    onTestFailed(alone);
    await ordersHome();
    await press(/^Approvals, 1 waiting/);
    await waitFor(/another approver must approve it/, 30_000);
    await shot("o16-approvals-own");
    await press(/^Fresh Farms, order/);
    await waitFor("Reject", 30_000);
    await shot("o17-order-own-pending");
    alone();
    await scroll(true);
    await back();
    await press(/^Fresh Farms, order/);
    await waitFor("Approve", 30_000);
    await press("Approve");
    await waitFor(/^Approve PO-/);
    await shot("o18-approve-question");
    await tap(/^APPROVE$|^Approve$/);
    await waitFor(/^Order approved/, 30_000);
    await shot("o19-order-approved");
    await back();
    await back();
  });

  it("from a sent order to its delivery, short, and back to claim it", async () => {
    const orders = await m.client.request<Array<{ poId: string; poNumber: string }>>("GET", `${API}/purchase-orders?storeLocationId=${locationId}`);
    const number = orders.find((o) => o.poId === ids.sent)!.poNumber;
    await ordersHome();
    await press("Sent");
    await sleep(1500);
    await press(new RegExp(`order ${number}`));
    await waitFor("Receive delivery", 30_000);
    await shot("o20-order-sent");
    await press("Receive delivery");
    await waitFor("Confirm delivery", 30_000);
    await shot("o21-delivery");
    await press(/^Plain flour,/);
    await tap("Short");
    await tap("3");
    await tap("Mark short");
    await waitFor(/^Confirm delivery · 1 issue/, 30_000);
    await press(/^Confirm delivery/);
    await waitFor("See the order", 30_000);
    await shot("o22-delivery-done");
    await press("See the order");
    await waitFor("To claim from the supplier", 30_000);
    await shot("o23-order-part-received");
    await press(/^Plain flour, Short/);
    await waitFor("Raise a credit note", 30_000);
    await shot("o24-credit-entry");
    await type("Supplier's reference (optional)", "CN-1042");
    await press("Raise credit note");
    await waitFor("Credit note raised", 30_000);
    await shot("o25-credit-raised");
    await press("Done");
    await waitFor("All orders", 30_000).catch(() => undefined);
    await press("All orders");
    await waitFor("New order", 30_000);
  });

  it("credit notes: what is left to claim, and the ones raised", async () => {
    // A second delivery, refused, so something is left to claim; and one with no price, which cannot be.
    for (const cost of ["17.50", ""]) {
      const po = await m.client.request<{ poId: string }>("POST", `${API}/purchase-orders`, { body: { storeLocationId: locationId, supplierId: ids.long, lines: [{ ingredientId: ids.flour, orderedQty: "2", orderedUnit: "bag", ...(cost ? { unitCost: cost } : {}) }] } });
      await m.client.request("POST", `${API}/purchase-orders/${po.poId}/submit`);
      if (!cost) await m.client.request("POST", `${API}/purchase-orders/${po.poId}/approve`);
      const s = await m.client.request<{ session: { sessionId: string }; lines: Array<{ receivingLineId: string }> }>("POST", `${API}/receiving/sessions`, { body: { poId: po.poId, storeLocationId: locationId } });
      await m.client.request("POST", `${API}/receiving/sessions/${s.session.sessionId}/lines/${s.lines[0].receivingLineId}`, { body: { status: "REJECTED", rejectionReason: "damaged" } });
      await m.client.request("POST", `${API}/receiving/sessions/${s.session.sessionId}/confirm`);
    }
    await ordersHome();
    await scroll(true);
    await press(/^Credit notes/);
    await waitFor("To claim", 30_000);
    await sleep(1500);
    await shot("o30-credit-notes");
    await tap("Raised");
    await waitFor("CN-1042", 30_000);
    await shot("o31-credit-notes-raised");
    await back();
  });

  it("with no signal", async () => {
    await ordersHome();
    await press("All");
    await sleep(2500);
    // Not airplane mode: the emulator's own link to this machine survives it. A dead tunnel or port is the same to the app.
    adb(["shell", "svc", "wifi", "disable"]);
    adb(["shell", "svc", "data", "disable"]);
    try {
      await sleep(4000);
      await scroll(true);
      await press(/^Credit notes/);
      await back();
      await waitFor(/This is the list from/, 60_000);
      await shot("o40-orders-offline");
      await press(/, Draft,/);
      await waitFor(/The items need a connection/, 60_000);
      await shot("o41-order-offline");
      await back();
      await press("New order");
      await waitFor(/Writing an order needs a connection/, 60_000);
      await shot("o42-new-order-offline");
      await back();
    } finally {
      adb(["shell", "svc", "wifi", "enable"]);
      adb(["shell", "svc", "data", "enable"]);
      await sleep(6000);
    }
  });

  it("on its side", async () => {
    await setRotation(true);
    await ordersHome();
    await sleep(2500);
    await shot("o50-orders-landscape");
    await press("New order");
    await waitFor("Start from a guide", 30_000);
    await press(/^Use the guide/);
    await waitFor(/^Plain flour, /, 30_000);
    await press(/^Plain flour, /);
    await sleep(800);
    await shot("o51-new-order-landscape");
    await back();
    await waitFor(/^Continue your order/, 30_000);
    await shot("o52-orders-continue");
  });
});

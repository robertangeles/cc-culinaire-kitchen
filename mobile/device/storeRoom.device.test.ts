import { describe, it, beforeAll, afterAll, beforeEach, onTestFailed } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { adb, back, clearApp, dump, fieldText, find, forceStop, has, hideKeyboard, openApp, setAirplane, setAnimations, setDarkMode, setFontScale, setRotation, swipe, tap, tapAt, typeInto, waitFor } from "./adb";
import { credentials, freshCode, manager } from "./fixtures";

/**
 * The store room screens on the real phone, photographed (Transfers: the list, a receive with a short line, a new transfer; Stock: the
 * dashboard, a critical list opened, an item, the lookup, a new-item request and my requests). It makes its own data through the API
 * first: a second location, four items with pars, stock moved in by transfers, one on its way, one waiting to be sent, two areas.
 * Run by `device/storeRoom.sh` through the lease, once per form: STOREROOM_FORM "phone" (the device as it is) or "tablet" (iPad portrait,
 * 820 dp wide, by `wm size`/`wm density`, reset afterwards). Pictures go to STOREROOM_OUT.
 */
const METRO = process.env.METRO_URL ?? "http://localhost:8088";
const API_URL = process.env.E2E_API_URL ?? "http://localhost:3009";
const OUT = process.env.STOREROOM_OUT ?? resolve(process.cwd(), "device/_shots/storeRoom");
const FORM = process.env.STOREROOM_FORM ?? "phone";
const INV = "/api/inventory";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sdk = process.env.ANDROID_HOME ?? `${process.env.HOME}/android-sdk`;
/** iPad portrait on the moto g86's 1220 px width: density = 1220 * 160 / 820. */
const TABLET = { size: "1220x1755", density: 238 };

const m = manager();
const ids: Record<string, string> = {};
let here = "";
let there = "";

const SAVE_PASSWORD = /Save password|Google Password Manager/i;
async function dismissSavePassword() {
  if (!(await has(SAVE_PASSWORD))) return false;
  await back();
  await sleep(600);
  return true;
}

async function shot(name: string) {
  await sleep(900);
  // Never photograph the save-password sheet: it shows the phone owner's Google account.
  for (let i = 0; i < 3 && (await dismissSavePassword()); i++);
  if (await has(SAVE_PASSWORD)) throw new Error(`not photographing ${name}: the save-password sheet is still up`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${FORM}-${name}.png`), execFileSync(process.env.ADB ?? `${sdk}/platform-tools/adb`, ["exec-out", "screencap", "-p"], { maxBuffer: 1 << 26 }));
}

const size = () => /(\d+)x(\d+)/.exec(adb(["shell", "wm", "size"]).trim().split("\n").pop()!)!.slice(1).map(Number) as [number, number];
const scroll = async (down: boolean) => {
  const [w, h] = size();
  await swipe(Math.round(w / 2), Math.round(h * (down ? 0.7 : 0.3)), Math.round(w / 2), Math.round(h * (down ? 0.3 : 0.7)), 300);
};

/** Tap a button by its accessibility label, scrolling down to it. */
async function press(label: string | RegExp) {
  for (let i = 0; i < 6; i++) {
    const button = (await dump()).find((n) => (typeof label === "string" ? n.desc === label : label.test(n.desc)) && n.clickable);
    if (button) return tapAt(Math.round((button.x1 + button.x2) / 2), Math.round((button.y1 + button.y2) / 2));
    await hideKeyboard();
    await scroll(true);
  }
  throw new Error(`no button labelled ${label}`);
}

/** Type into a field and check it took (the save-password sheet can swallow keystrokes). */
async function type(label: string, text: string) {
  for (let i = 0; i < 6; i++) {
    await dismissSavePassword();
    const field = await find(label, (n) => n.find((x) => x.cls.includes("EditText")));
    if (!field) {
      // Below the keyboard on a long form, or scrolled past: look further down first, then back up.
      await hideKeyboard();
      await scroll(i < 3);
      continue;
    }
    await tapAt(Math.round((field.x1 + field.x2) / 2), Math.round((field.y1 + field.y2) / 2));
    await sleep(1000);
    if (await dismissSavePassword()) continue;
    adb(["shell", "input", "keyevent", "KEYCODE_MOVE_END", ...Array(40).fill("KEYCODE_DEL")]);
    await typeInto(label, text);
    if (label.toLowerCase().includes("password") || (await fieldText(label)) === text) return;
  }
  throw new Error(`could not type into ${label}`);
}

/** After `pm clear` the dev client shows its floating Tools button again: switch it off so it is not in the pictures (as device/screens does on the visual-pass branch). */
async function hideDevTools() {
  for (let i = 0; i < 10 && !(await has("Tools")); i++) await sleep(1000);
  if (!(await has("Tools"))) return;
  const [w, h] = size();
  const dpi = Number(/(\d+)\s*$/.exec(adb(["shell", "wm", "density"]).trim())![1]);
  await tap("Tools");
  try {
    for (let i = 0; i < 3; i++) {
      const row = await waitFor("Tools button", 10_000).catch(() => null);
      if (!row) break;
      if (row.y2 < h * 0.8) {
        await tapAt(w - Math.round((67 * dpi) / 160), Math.round((row.y1 + row.y2) / 2)); // the switch's centre is 67 dp in from the right edge
        break;
      }
      await swipe(Math.round(w / 2), Math.round(h * 0.7), Math.round(w / 2), Math.round(h * 0.2), 400);
    }
  } finally {
    for (let i = 0; i < 3 && (await has("Toggle performance monitor")); i++) await back();
    await sleep(800);
  }
}

const tab = (title: string) => tap(new RegExp(`^${title}(,|$)`), 30_000);

async function signIn() {
  forceStop();
  clearApp();
  await openApp(METRO);
  await sleep(6000);
  if (await has("Go home")) await back();
  await hideDevTools();
  await waitFor("Welcome back to the line.", 240_000);
  await type("Email", credentials.email);
  await type("Password", credentials.password);
  await hideKeyboard();
  const all = (await dump()).filter((n) => n.desc === "Sign in" && n.clickable);
  const button = all[all.length - 1];
  await tapAt(Math.round((button.x1 + button.x2) / 2), Math.round((button.y1 + button.y2) / 2));
  for (let i = 0; i < 6 && !(await has("Enter your 6-digit code")); i++) {
    await dismissSavePassword();
    await sleep(800);
  }
  await waitFor("Enter your 6-digit code", 30_000);
  const field = await find("Code", (n) => n.find((x) => x.cls.includes("EditText")));
  await tapAt(Math.round((field!.x1 + field!.x2) / 2), Math.round((field!.y1 + field!.y2) / 2));
  adb(["shell", "input", "text", await freshCode()]);
  adb(["shell", "input", "keyevent", "KEYCODE_ENTER"]);
  await waitFor(/^Account(,|$)/, 60_000);
  for (let i = 0; i < 6 && (await dismissSavePassword()); i++);
}

/** A transfer between the two locations made as the web would: created, then sent and received when asked. */
async function transferIn(lines: [string, number, string, number?][], until: "INITIATED" | "SENT" | "RECEIVED", from = there, to = here) {
  const t = await m.client.request<{ transferId: string; lines: { lineId: string; ingredientId: string }[] }>("POST", `${INV}/transfers`, { body: { fromLocationId: from, toLocationId: to, lines: lines.map(([k, q, u]) => ({ ingredientId: ids[k], sentQty: q, sentUnit: u })) } });
  if (until === "INITIATED") return;
  await m.client.request("POST", `${INV}/transfers/${t.transferId}/send`);
  if (until === "SENT") return;
  const got = new Map(lines.map(([k, q, , r]) => [ids[k], r ?? q]));
  await m.client.request("POST", `${INV}/transfers/${t.transferId}/receive`, { body: { receivedLines: t.lines.map((l) => ({ lineId: l.lineId, receivedQty: got.get(l.ingredientId) })) } });
}

describe.skipIf(!process.env.STOREROOM_OUT)(`store room screens on ${FORM}`, () => {
  beforeEach((ctx) => {
    onTestFailed(async ({ task }) => {
      process.stderr.write(`FAILED ${task.name}: ${task.result?.errors?.[0]?.message ?? "?"}\n`);
      await shot(`FAILED-${ctx.task.name.slice(0, 40).replace(/[^a-z0-9]+/gi, "-")}`).catch(() => {});
    });
  });

  beforeAll(async () => {
    adb(["devices"]);
    for (const url of [METRO, API_URL]) adb(["reverse", `tcp:${new URL(url).port}`, `tcp:${new URL(url).port}`]);
    await setAirplane(false);
    setAnimations(false);
    setFontScale(1.0);
    setDarkMode(false);
    await setRotation(false);
    adb(["shell", "wm", "size", FORM === "tablet" ? TABLET.size : "reset"]);
    adb(["shell", "wm", "density", FORM === "tablet" ? String(TABLET.density) : "reset"]);

    await m.signIn();
    const ctx = await m.client.request<{ selectedLocationId: string; organisationId: number }>("GET", "/api/users/location-context");
    here = ctx.selectedLocationId;
    there = (await m.client.request<{ storeLocation: { storeLocationId: string } }>("POST", "/api/store-locations", { body: { organisationId: ctx.organisationId, locationName: "Harbour St kitchen", classification: "branch" } })).storeLocation.storeLocationId;
    for (const [key, name, category, unit, cost] of [["gin", "London dry gin", "spirits", "L", "32.00"], ["tonic", "Tonic water", "beverages", "each", "1.20"], ["lemon", "Lemons", "produce", "each", "0.50"], ["salt", "Sea salt flakes", "dry_goods", "kg", "8.00"]] as const) {
      ids[key] = (await m.client.request<{ ingredientId: string }>("POST", `${INV}/ingredients`, { body: { ingredientName: name, ingredientCategory: category, baseUnit: unit, unitCost: cost } })).ingredientId;
    }
    await m.client.request("POST", `${INV}/locations/${here}/activate-items`, { body: { ingredientIds: Object.values(ids) } });
    for (const [key, par] of [["gin", "6"], ["tonic", "24"], ["lemon", "30"], ["salt", "5"]]) await m.client.request("PATCH", `${INV}/locations/${here}/ingredients/${ids[key]}`, { body: { parLevel: par } });
    for (const [name, keys, order] of [["Back bar", ["gin", "tonic", "lemon"], 1], ["Dry store", ["salt"], 2]] as const) {
      const area = await m.client.request<{ storageAreaId: string }>("POST", `${INV}/locations/${here}/storage-areas`, { body: { areaName: name, sortOrder: order } });
      await m.client.request("PUT", `${INV}/storage-areas/${area.storageAreaId}/items`, { body: { items: keys.map((k) => ({ ingredientId: ids[k] })) } });
    }
    // Stock arrives by transfer: gin critical (1 of 6), tonic low (12 of 24, received two short), lemons and salt fine.
    await transferIn([["gin", 1, "L"], ["lemon", 28, "each"], ["salt", 5, "kg"]], "RECEIVED");
    await transferIn([["tonic", 14, "each", 12]], "RECEIVED");
    await transferIn([["gin", 2, "L"], ["lemon", 10, "each"]], "SENT");
    await transferIn([["salt", 1.5, "kg"]], "INITIATED", here, there);
    await signIn();
  });

  afterAll(async () => {
    adb(["shell", "wm", "size", "reset"]);
    adb(["shell", "wm", "density", "reset"]);
  });

  it("transfers: the list, a receive with a short line, a new transfer", async () => {
    await tab("Transfers");
    await waitFor(/^to receive$/i, 30_000);
    await shot("transfers-list");
    await press(/^From Harbour St kitchen, 2 items, On its way/);
    await waitFor(/^what arrived$/i, 30_000);
    await type("Lemons received, in each", "8");
    await hideKeyboard();
    await waitFor("Short by 2 each");
    await shot("transfer-receive");
    await press("Back to transfers");
    await press("New transfer");
    await waitFor(/^going to$/i);
    await press("Harbour St kitchen");
    await type("Add an item", "sea");
    await tap("Use Sea salt flakes", 30_000);
    await type("How much Sea salt flakes, in kg", "2");
    await hideKeyboard();
    await shot("transfer-new");
    await press("Cancel");
  });

  it("stock: the dashboard, the critical list, an item, the lookup, a request and my requests", async () => {
    await tab("Stock");
    await waitFor(/^Critical, reorder now/, 30_000);
    await shot("stock-dashboard");
    await press(/^Critical, reorder now/);
    await shot("stock-critical-open");
    await press(/^London dry gin, on hand/);
    await waitFor(/^kept in$/i);
    await shot("stock-item");
    await press("Back");
    await press("Look up an item");
    await type("Search the catalogue", "le");
    await hideKeyboard();
    await shot("stock-lookup");
    await type("Search the catalogue", "yuzu");
    await press("Not in the catalogue? Ask for it");
    await waitFor("Ask for a new item");
    await press("Kitchen Ingredient");
    await press("Beverages");
    await type("Unit it's counted in (optional)", "L");
    await type("How many you have now (optional)", "2");
    await hideKeyboard();
    await shot("stock-request-form");
    await press("Send request");
    await waitFor("My requests", 30_000);
    await sleep(3000); // the queue sends it: "Sent for review"
    await shot("stock-requests");
  });
});

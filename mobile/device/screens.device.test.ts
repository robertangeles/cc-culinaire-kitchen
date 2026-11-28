import { describe, it, beforeAll, afterAll, beforeEach, onTestFailed } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  adb, back, clearApp, dismissSavePassword, openTab, dump, fieldText, find, isSavePasswordSheet, findAll, forceStop, has, hideKeyboard, openApp, setAirplane, setAnimations, setDarkMode, setFontScale,
  setRotation, swipe, tap as tapNow, tapAt, typeInto, waitFor, waitGone,
} from "./adb";
import { io, type Socket } from "socket.io-client";
import { createApiClient, type Tokens } from "../src/api/client";
import { credentials, freshCode, manager } from "./fixtures";

/**
 * The screenshot walk: every screen of the phone app and its main states (empty, filled, error, offline or queued, long text), photographed
 * for a person to look at. It asserts only that it reached each screen; the look is judged from the images. Run it through `device/screens.sh`,
 * which makes a fresh database, the server and Metro, runs this file once per form factor and writes the gallery.
 *
 * SCREENS_FORM: "phone" (the device as it is), "tablet" (iPad portrait, 820 x 1180 dp) or "tablet-landscape" (1180 x 820 dp). The tablet forms
 * set the phone's display size and density with `wm`, so the real Android runtime lays the app out at iPad width; both are reset afterwards.
 * The tablet emulator is already iPad portrait: there "tablet" changes nothing and "tablet-landscape" turns its display on its side.
 * Images go to SCREENS_OUT/<form>/<name>.png.
 */
const METRO = process.env.METRO_URL ?? "http://127.0.0.1:8088";
const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:3009";
const FORM = process.env.SCREENS_FORM ?? "phone";
const OUT = resolve(process.env.SCREENS_OUT ?? "device/_shots/screens", FORM);
const INV = "/api/inventory";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sdk = process.env.ANDROID_HOME ?? `${process.env.HOME}/Android/Sdk`;

/** The display override a form needs: none for the device as it is; on a phone its own width stands in for the iPad's (density = px * 160 / width in dp). */
function displayOf(form: string): { size: string; density: number } | undefined {
  if (form === "phone") return undefined;
  const [w, h] = /Physical size: (\d+)x(\d+)/.exec(adb(["shell", "wm", "size"]))!.slice(1).map(Number);
  const dpi = Number(/Physical density: (\d+)/.exec(adb(["shell", "wm", "density"]))![1]);
  const [dpW, dpH] = form === "tablet" ? [820, 1180] : [1180, 820];
  if ((w * 160) / dpi >= 800) return form === "tablet" ? undefined : { size: `${h}x${w}`, density: dpi };
  return { size: `${w}x${Math.round((w * dpH) / dpW)}`, density: Math.round((w * 160) / dpW) };
}

async function shot(name: string) {
  await sleep(700); // let a transition or a list finish moving
  // Never photograph the save-password sheet: it shows the phone owner's Google account.
  for (let i = 0; i < 3 && (await dismissSavePassword()); i++);
  if (isSavePasswordSheet(await dump())) throw new Error(`not photographing ${name}: the save-password sheet is still on screen`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${name}.png`), execFileSync(process.env.ADB ?? `${sdk}/platform-tools/adb`, ["exec-out", "screencap", "-p"], { maxBuffer: 1 << 26 }));
}

function setDisplay(form: string) {
  const d = displayOf(form);
  adb(["shell", "wm", "size", d ? d.size : "reset"]);
  adb(["shell", "wm", "density", d ? String(d.density) : "reset"]);
}

/** The display as the app has it: the override when there is one, else the device's own size. */
const screen = () => /(\d+)x(\d+)/.exec(adb(["shell", "wm", "size"]).trim().split("\n").pop()!)!.slice(1).map(Number) as [number, number];
/** Scroll the page by a third of the screen: down it (further on) or back up. */
async function scroll(dir: "down" | "up") {
  const [w, h] = screen();
  const [from, to] = dir === "down" ? [0.7, 0.4] : [0.35, 0.65];
  await swipe(Math.round(w / 2), Math.round(h * from), Math.round(w / 2), Math.round(h * to), 300);
}

type Node = Awaited<ReturnType<typeof dump>>[number];
/**
 * The node once it is well on screen, scrolling down the page for it and then back up: at iPad landscape height a form's lower half starts
 * below the fold. One that stays at the bottom (the tab bar, a pinned button) is returned where it is.
 */
async function reach(pick: (nodes: Node[]) => Node | undefined): Promise<Node | undefined> {
  const [, h] = screen();
  let last: Node | undefined;
  for (const dir of ["down", "down", "down", "down", "down", "down", "up", "up", "up", "up", "up", "up", "up", "up"] as const) {
    const node = pick(await dump());
    if (node && (node.y2 < h * 0.84 || (last && last.y1 === node.y1))) return node;
    last = node;
    await scroll(dir);
  }
  return pick(await dump());
}
const tapNode = (n: Node) => tapAt(Math.round((n.x1 + n.x2) / 2), Math.round((n.y1 + n.y2) / 2));

/** Tap the thing with this text or label, waiting for it and then scrolling to it. */
async function tap(m: string | RegExp, timeoutMs = 20_000) {
  const is = (v: string) => v !== "" && (typeof m === "string" ? v === m : m.test(v));
  if (await waitFor(m, 8_000).then(() => true, () => false)) return tapNow(m);
  const node = await reach((nodes) => nodes.find((n) => is(n.text) || is(n.desc)));
  return node ? tapNode(node) : tapNow(m, timeoutMs);
}

/** Tap a control by its accessibility label only, scrolling to it. */
async function tapLabel(label: string) {
  const node = await reach((nodes) => nodes.find((n) => n.desc === label));
  if (!node) throw new Error(`no control labelled ${label}`);
  await tapNode(node);
}

/** One statement on the walk's own throwaway database, for what no route makes (a published legal page, a notification). Never any other database. */
function sql(statement: string): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.port !== "55432") throw new Error(`not the local test cluster: ${url.host}`);
  return execFileSync("psql", [url.href, "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8" }).trim();
}

const m = manager();
const NAMES = {
  salt: "Sea salt flakes",
  onion: "Brown onion",
  shiraz: "House shiraz",
  long: "Heirloom tomato and roasted red capsicum relish, house batch for the weekend",
  dish: "French onion soup",
  areaA: "Dry store",
  areaB: "Back bar",
  location2: "Harbour St kitchen",
  lamb: "Lamb shoulder",
  gin: "London dry gin",
  tonic: "Tonic water",
  supplier: "Harbour Produce",
  supplierLong: "Yarra Valley Growers and Smallgoods Cooperative",
};
let locationId = "";

async function launch() {
  forceStop();
  await openApp(METRO);
  await sleep(6000);
  if (await has("Go home")) await back();
}

/** After `pm clear` the dev client shows its floating Tools button again: switch it off so it is not in the pictures. */
async function hideDevTools() {
  if (!(await has("Tools"))) return;
  const [w, h] = screen();
  const dpi = Number(/(\d+)\s*$/.exec(adb(["shell", "wm", "density"]).trim())![1]);
  await tap("Tools");
  try {
    // The menu opens half-height, with the switch under the navigation bar: drag it up until the row is well on screen.
    for (let i = 0; i < 3; i++) {
      // The menu does not always show the row in time: leave the gear in the picture rather than fail the walk.
      const row = await waitFor("Tools button", 10_000).catch(() => null);
      if (!row) break;
      if (row.y2 < h * 0.8) {
        // The switch's centre is 67 dp in from the menu's right edge; the menu is at most 640 dp wide, in the middle.
        await tapAt(Math.min(w, Math.round(w / 2 + (320 * dpi) / 160)) - Math.round((67 * dpi) / 160), Math.round((row.y1 + row.y2) / 2));
        break;
      }
      await swipe(Math.round(w / 2), Math.round(h * 0.7), Math.round(w / 2), Math.round(h * 0.2), 400);
    }
  } finally {
    for (let i = 0; i < 3 && (await has("Toggle performance monitor")); i++) await back();
    await sleep(800);
  }
}

const lowest = async (label: string) => {
  const all = await findAll(label);
  const n = all[all.length - 1];
  await tapAt(Math.round((n.x1 + n.x2) / 2), Math.round((n.y1 + n.y2) / 2));
};

async function typePassword(email: string, password: string) {
  await waitFor("Welcome back to the line.", 60_000);
  // Google's autofill sheet can come up over the password field and clear the email when it goes: check both are in before going on.
  for (let i = 0; i < 3; i++) {
    await type("Email", email);
    await type("Password", password);
    await hideKeyboard();
    await dismissSavePassword();
    if ((await fieldText("Email")) === email) return;
  }
  throw new Error("the email would not stay typed in");
}

async function submitSignIn() {
  await lowest("Sign in");
  // The save-password sheet comes a few seconds after the sign-in: wait it out so it cannot swallow the next keystrokes.
  for (let i = 0; i < 10; i++) {
    if (await dismissSavePassword()) break;
    await sleep(800);
  }
}

/**
 * Type into a field and check it took. Focusing an email field can bring up Google's "use your saved password" sheet, which takes the
 * keystrokes: close it (Back), focus the field again and type only once no sheet is up.
 */
async function type(label: string, text: string) {
  for (let i = 0; i < 6; i++) {
    await dismissSavePassword();
    await hideKeyboard(); // a field can be behind the keyboard, where a tap would type a letter
    const field = await find(label, (n) => n.find((x) => x.cls.includes("EditText")));
    if (!field) {
      // Scrolled past it (a long form after its button was pressed): scroll back up.
      await scroll("up");
      continue;
    }
    await tapAt(Math.round((field.x1 + field.x2) / 2), Math.round((field.y1 + field.y2) / 2));
    await sleep(1200);
    if (await dismissSavePassword()) continue;
    adb(["shell", "input", "keyevent", "KEYCODE_MOVE_END", ...Array(60).fill("KEYCODE_DEL")]);
    await typeInto(label, text);
    if (label.toLowerCase().includes("password") || (await fieldText(label)) === text) return;
  }
  throw new Error(`could not type into ${label}`);
}

/** Tap a button by its label, scrolling to it: a long form's button starts below the screen, under a title with the same words. */
async function press(label: string) {
  await hideKeyboard();
  const button = await reach((nodes) => nodes.find((n) => n.desc === label && n.clickable));
  if (!button) throw new Error(`no button labelled ${label}`);
  await tapNode(button);
}

/** Bring a control into view on a long page, then leave it where it is. */
async function scrollTo(label: string | RegExp) {
  const is = (v: string) => v !== "" && (typeof label === "string" ? v === label : label.test(v));
  if (!(await reach((nodes) => nodes.find((n) => is(n.text) || is(n.desc))))) throw new Error(`could not scroll to ${String(label)}`);
}
const scrollToEnd = async () => {
  for (let i = 0; i < 12; i++) await scroll("down");
};

/** Digits on the app's own keypad. */
async function keypad(digits: string) {
  for (const d of digits) await tapLabel(d === "." ? "Decimal point" : d === "0" ? "Zero, none here" : d);
}

/** A purchase order sent to its supplier, made and approved as a manager does on the web. */
async function sentOrder(supplierId: string, lines: Array<{ ingredientId: string; qty: string; cost: string }>, expected?: string) {
  const po = await m.client.request<{ poId: string }>("POST", `${INV}/purchase-orders`, {
    body: { storeLocationId: locationId, supplierId, expectedDeliveryDate: expected, lines: lines.map((l) => ({ ingredientId: l.ingredientId, orderedQty: l.qty, orderedUnit: "kg", unitCost: l.cost })) },
  });
  await m.client.request("POST", `${INV}/purchase-orders/${po.poId}/submit`);
}
/** The organisation's second location, made by whichever test needs it first. */
let secondLocationId = "";
async function secondLocation(): Promise<string> {
  if (!secondLocationId) {
    const ctx = await m.client.request<{ organisationId: number }>("GET", "/api/users/location-context");
    secondLocationId = (await m.client.request<{ storeLocation: { storeLocationId: string } }>("POST", "/api/store-locations", { body: { organisationId: ctx.organisationId, locationName: NAMES.location2 } })).storeLocation.storeLocationId;
  }
  return secondLocationId;
}

/** A transfer between two locations made as the web makes it, then sent and received (all of it) when asked. */
async function transfer(from: string, to: string, lines: Array<{ ingredientId: string; sentQty: number; sentUnit: string }>, until: "INITIATED" | "SENT" | "RECEIVED") {
  const t = await m.client.request<{ transferId: string; lines: Array<{ lineId: string; sentQty: number }> }>("POST", `${INV}/transfers`, { body: { fromLocationId: from, toLocationId: to, lines } });
  if (until === "INITIATED") return;
  await m.client.request("POST", `${INV}/transfers/${t.transferId}/send`);
  if (until === "SENT") return;
  await m.client.request("POST", `${INV}/transfers/${t.transferId}/receive`, { body: { receivedLines: t.lines.map((l) => ({ lineId: l.lineId, receivedQty: Number(l.sentQty) })) } });
}

const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Open one of Account's rows. */
async function accountRow(label: string) {
  await tab("Account");
  await waitFor("My details", 30_000);
  await tap(label);
}

/**
 * Type a two-step code and send it with the keyboard's Go key. A real code is made only once the field is focused and empty: it is good
 * for the rest of its 30 seconds, and the checks that make typing reliable take several. Wrong codes count against the server's limit of
 * five failures in 15 minutes, so a refused real code is not retried here.
 */
async function enterCode(code: string | typeof freshCode) {
  await waitFor("Enter your 6-digit code", 30_000);
  await dismissSavePassword();
  const field = await find("Code", (n) => n.find((x) => x.cls.includes("EditText")));
  if (!field) throw new Error("no code field");
  await tapAt(Math.round((field.x1 + field.x2) / 2), Math.round((field.y1 + field.y2) / 2));
  await sleep(800);
  adb(["shell", "input", "keyevent", "KEYCODE_MOVE_END", ...Array(8).fill("KEYCODE_DEL")]);
  const value = typeof code === "string" ? code : await code();
  adb(["shell", "input", "text", value]);
  adb(["shell", "input", "keyevent", "KEYCODE_ENTER"]);
  await sleep(1500);
}

const tab = (title: string) => openTab(title);


/**
 * Each test starts from a known state on its own, so one that fails cannot leave the next on the wrong screen: stop the app, clear this
 * app's data only (`pm clear` on the development build's package), open it on Metro again and switch off the dev Tools button.
 * That lands on the sign-in screen; `signedIn` then signs in the E2E user with the two-step code.
 */
async function toSignIn() {
  forceStop();
  clearApp();
  await launch();
  await hideDevTools();
  await waitFor("Welcome back to the line.", 240_000);
}

async function signedIn() {
  await toSignIn();
  await typePassword(credentials.email, credentials.password);
  await submitSignIn();
  await enterCode(freshCode);
  await waitFor(/^More(,|$)|^Account(,|$)/, 60_000);
}

/** A store room with something to look at: gin critical and tonic low against par, one transfer on its way here, one waiting to be sent. */
let stocked = false;
async function stockRoom() {
  if (stocked) return;
  const there = await secondLocation();
  const item = async (name: string, unit: string, cost: string) =>
    (await m.client.request<{ ingredientId: string }>("POST", `${INV}/ingredients`, { body: { ingredientName: name, ingredientCategory: "beverages", baseUnit: unit, unitCost: cost } })).ingredientId;
  const gin = await item(NAMES.gin, "L", "32.00");
  const tonic = await item(NAMES.tonic, "each", "1.20");
  await m.client.request("POST", `${INV}/locations/${locationId}/activate-items`, { body: { ingredientIds: [gin, tonic] } });
  for (const [id, parLevel] of [[gin, "6"], [tonic, "24"]]) await m.client.request("PATCH", `${INV}/locations/${locationId}/ingredients/${id}`, { body: { parLevel } });
  const line = (ingredientId: string, sentQty: number) => ({ ingredientId, sentQty, sentUnit: ingredientId === gin ? "L" : "each" });
  await transfer(there, locationId, [line(gin, 1), line(tonic, 12)], "RECEIVED");
  await transfer(there, locationId, [line(gin, 2), line(tonic, 10)], "SENT");
  await transfer(locationId, there, [line(tonic, 3)], "INITIATED");
  stocked = true;
}

async function pick(field: string, typed: string, name: string) {
  await type(field, typed);
  await tap(`Use ${name}`, 30_000);
}

describe.skipIf(!process.env.SCREENS_OUT)(`screens on ${FORM}`, { timeout: 600_000 }, () => {
  beforeEach((ctx) => {
    onTestFailed(async ({ task }) => {
      // Said at once, so a walk that is stopped early still shows why its tests failed.
      process.stderr.write(`FAILED ${task.name}: ${task.result?.errors?.[0]?.message ?? "?"}\n`);
      await shot(`FAILED-${ctx.task.name.slice(0, 40).replace(/[^a-z0-9]+/gi, "-")}`).catch(() => {});
      await setAirplane(false); // a test that died offline must not take the next one's Metro away
    });
  });

  beforeAll(async () => {
    adb(["devices"]);
    const metroPort = new URL(METRO).port;
    adb(["reverse", `tcp:${metroPort}`, `tcp:${metroPort}`]);
    const apiPort = new URL(API_URL).port;
    adb(["reverse", `tcp:${apiPort}`, `tcp:${apiPort}`]);
    await setAirplane(false);
    setAnimations(false);
    setFontScale(1.0);
    setDarkMode(false);
    await setRotation(false);
    setDisplay(FORM);
    await m.signIn();
    const ctx = await m.client.request<{ selectedLocationId: string }>("GET", "/api/users/location-context");
    locationId = ctx.selectedLocationId;
    // A new location starts with five areas of its own: without them the Move tab shows its "no areas" state first, and the count has only the walk's two.
    for (const a of await m.client.request<Array<{ storageAreaId: string }>>("GET", `${INV}/locations/${locationId}/storage-areas`)) {
      await m.client.request("DELETE", `${INV}/storage-areas/${a.storageAreaId}`);
    }
    for (const [name, unit] of [[NAMES.salt, "kg"], [NAMES.shiraz, "L"], [NAMES.long, "kg"]] as const) {
      await m.client.request("POST", `${INV}/ingredients`, { body: { ingredientName: name, ingredientCategory: "dry_goods", baseUnit: unit, unitCost: "4.20" } });
    }
    const dish = await m.client.request<{ menuItemId: string }>("POST", "/api/menu/items", { body: { name: NAMES.dish, category: "Starter", sellingPrice: "14.00" } });
    for (const [name, qty] of [[NAMES.onion, "0.4"], ["Gruyère", "0.1"], ["Beef stock", "0.3"]]) {
      await m.client.request("POST", `/api/menu/items/${dish.menuItemId}/ingredients`, { body: { ingredientName: name, quantity: qty, unit: "kg" } });
    }
  });

  afterAll(async () => {
    await setAirplane(false);
    setDisplay("phone");
    setAnimations(true);
    await m.client.request("PUT", "/api/settings", { body: { mobile_min_app_version: "0.0.0" } }).catch(() => {});
  });

  it("signed out: sign in, register, keyboard, wrong password", async () => {
    await toSignIn();
    await waitFor("Welcome back to the line.", 240_000);
    await shot("01-sign-in");
    await tap("Register");
    await waitFor("Join the line.");
    await shot("01b-register");
    await tap("Sign in");
    await type("Email", credentials.email);
    await type("Password", "not-the-password");
    await shot("01c-sign-in-keyboard");
    await hideKeyboard();
    await submitSignIn();
    await waitFor(/password/i);
    await shot("01d-sign-in-error");
  });

  it("forgot password and check your email", async () => {
    await toSignIn();
    await tap("Forgot password");
    await waitFor("Reset your password");
    await shot("02-forgot-password");
    await type("Email", "someone@kitchen.co");
    await hideKeyboard();
    await tap("Send reset link");
    await waitFor("Check your email", 30_000);
    await shot("03-check-email");
    await tap("Back to sign in");
    await waitFor("Welcome back to the line.");
  });

  it("terms and privacy", async () => {
    await toSignIn();
    await tap("Terms of Service");
    await sleep(3000);
    await shot("04-legal-terms");
    await tap("Back");
    // The owner publishes these pages on the web (Settings, Site Pages); until then the app says so (the image above).
    const body = `## 1. Using the app\n\nThis is a test page, not the real terms. You keep the recipes and counts you make here.\n\n- Keep your password to yourself\n- Tell us when a price is **wrong**\n\n## 2. Your data\n\n${"What you log belongs to your kitchen. ".repeat(6)}`;
    for (const [slug, title] of [["terms", "Terms of Service"], ["privacy", "Privacy Policy"]]) {
      sql(`insert into site_page (slug, surface, title, body_md, published_ind) values ('${slug}', 'mobile', '${title}', '${body}', true) on conflict (slug, surface) do update set body_md = excluded.body_md, published_ind = true`);
    }
    await tap("Terms of Service");
    await waitFor(/Using the app/, 20_000);
    await shot("04c-legal-terms-published");
    await scrollToEnd();
    await tap("Back");
    await tap("Privacy Policy");
    await sleep(3000);
    await shot("04b-legal-privacy");
    await scrollToEnd();
    await tap("Back");
    await waitFor("Welcome back to the line.");
  });

  it("update required", async () => {
    await toSignIn();
    await m.client.request("PUT", "/api/settings", { body: { mobile_min_app_version: "9.9.9" } });
    try {
      await typePassword(credentials.email, credentials.password);
      await submitSignIn();
      await waitFor("Update to continue", 30_000);
      await shot("05-update-required");
    } finally {
      await m.client.request("PUT", "/api/settings", { body: { mobile_min_app_version: "0.0.0" } });
    }
  });

  it("two-step code: empty, wrong code, then signed in", async () => {
    await toSignIn();
    await typePassword(credentials.email, credentials.password);
    await submitSignIn();
    await waitFor("Enter your 6-digit code", 30_000);
    await shot("06-mfa");
    await enterCode("000000");
    await sleep(2500);
    await shot("06b-mfa-error");
    await enterCode(freshCode);
    await waitFor(/^More(,|$)|^Account(,|$)/, 60_000);
  });

  it("home, ask, recipes, receive, inbox, transfers, stock", async () => {
    await signedIn();
    await sleep(2500);
    await shot("07-home");
    // The landing was replaced, not stacked: Back from the first screen leaves the app instead of opening Ask.
    await back();
    await sleep(2000);
    if (await has("Ask Antoine")) throw new Error("Back from the first screen opened Ask");
    // A cold start while signed in lands on the same first tab (the E2E Administrator's is Prep, empty here).
    await launch();
    await waitFor("Plan today's prep", 60_000);
    await tab("Ask");
    await waitFor("New conversation", 30_000);
    await shot("80-ask");
    await tap("New conversation");
    await waitFor("My hollandaise split. How do I fix it?", 20_000);
    await shot("81-ask-conversation");
    await tab("Recipes");
    await waitFor("No recipes yet", 30_000);
    await shot("85-recipes-empty");
    await tap("Create a recipe");
    await waitFor("What would you like to create?", 20_000);
    await shot("86-recipe-lab");
    await tab("Receive");
    await waitFor("No deliveries waiting", 30_000);
    await shot("90-receive-empty");
    await tab("Inbox");
    await waitFor("You're all caught up", 30_000);
    await shot("95-inbox-empty");
    await tab("Transfers");
    await waitFor("No transfers yet", 30_000);
    await shot("55-transfers-empty");
    await tab("Stock");
    await waitFor("No stock figures yet", 30_000);
    await shot("45-stock-empty");
  });

  it("count with no stock take open", async () => {
    await signedIn();
    await tab("Count");
    await sleep(2500);
    await shot("10-count-none");
  });

  it("waste: empty, form, error, filled, long text, offline", async () => {
    await signedIn();
    await tab("Waste");
    await waitFor("Nothing logged today.", 30_000);
    await shot("20-waste-empty");
    await tap("Log waste");
    await waitFor("What was thrown away");
    await shot("21-waste-form");
    await press("Log waste");
    await waitFor("Say what was thrown away.");
    await shot("21c-waste-form-error");
    await type("What was thrown away", "Sea");
    await sleep(1500);
    await shot("21b-waste-form-picker");
    await tap(`Use ${NAMES.salt}`, 30_000);
    await type("How much", "1.5");
    await hideKeyboard();
    await tapLabel("Spoilage");
    await tapLabel("Dinner");
    await shot("21d-waste-form-filled");
    await press("Log waste");
    await waitGone("1 waiting to send", 60_000);
    await tap("Log waste");
    await type("What was thrown away", NAMES.long);
    await type("How much", "12.75");
    await hideKeyboard();
    await tapLabel("Overproduction");
    await press("Log waste");
    await waitGone(/waiting to send/, 60_000);
    await shot("22-waste-list");
    await tap(new RegExp(`^${NAMES.salt}, 1.5 kg.*Edit$`));
    await waitFor("How much");
    await shot("22b-waste-edit");
    await back();
    await setAirplane(true);
    await tap("Log waste");
    await type("What was thrown away", "Basil");
    await type("How much", "3");
    await hideKeyboard();
    await tapLabel("bunch");
    await press("Log waste");
    await waitFor("1 waiting to send", 30_000);
    await sleep(2500);
    await shot("23-waste-offline");
    await setAirplane(false);
    await waitGone("1 waiting to send", 120_000);
  });

  it("prep: nothing planned, plan, list, offline tick", async () => {
    await signedIn();
    await tab("Prep");
    await waitFor("Nothing planned for today yet.", 30_000);
    await shot("30-prep-empty");
    await tap("Plan today's prep");
    await waitFor(`More ${NAMES.dish}`, 30_000);
    await tapLabel(`More ${NAMES.dish}`);
    for (let i = 0; i < 11; i++) await tapLabel(`More ${NAMES.dish}`);
    await type("Expected covers (optional)", "80");
    await hideKeyboard();
    await shot("31-prep-plan");
    await press("Make today's prep list");
    await waitFor(new RegExp(`^${NAMES.onion}, `), 60_000);
    await shot("32-prep-list");
    await setAirplane(true);
    await tap(new RegExp(`^${NAMES.onion}, `));
    await waitFor("Waiting to send", 15_000);
    await shot("33-prep-offline-tick");
    await setAirplane(false);
    await waitGone("Waiting to send", 120_000);
  });

  it("usage: empty, form, filled, the move question, offline", async () => {
    await signedIn();
    await tab("Usage");
    await waitFor("Nothing logged today.", 30_000);
    await shot("40-usage-empty");
    await tap("Log usage");
    await waitFor("What was used");
    await shot("41-usage-form");
    await pick("What was used", "Sea", NAMES.salt);
    await type("How much", "2.5");
    await hideKeyboard();
    await tapLabel("Kitchen");
    await tapLabel("PM");
    await shot("41b-usage-form-filled");
    await press("Log usage");
    await waitGone(/waiting to send/, 60_000);
    await tap("Log usage");
    await pick("What was used", "Heirloom", NAMES.long);
    await type("How much", "4");
    await hideKeyboard();
    await tapLabel("Staff");
    await press("Log usage");
    await waitGone(/waiting to send/, 60_000);
    await shot("42-usage-list");
    await tap("Log usage");
    await pick("What was used", "House", NAMES.shiraz);
    await type("How much", "1");
    await hideKeyboard();
    await tapLabel("FOH");
    await press("Log usage");
    await waitFor("Taking stock to the bar or front of house?", 15_000);
    await shot("43-usage-move-question");
    await tap(/^Go back$/i);
    await tap("Cancel");
    await setAirplane(true);
    await tap("Log usage");
    await pick("What was used", "Sea", NAMES.salt);
    await type("How much", "0.5");
    await hideKeyboard();
    await tapLabel("Cleaning");
    await press("Log usage");
    await waitFor("1 waiting to send", 30_000);
    await sleep(2500);
    await shot("44-usage-offline");
    await setAirplane(false);
    await waitGone("1 waiting to send", 120_000);
  });

  it("move: no areas, then empty, form, filled, offline", async () => {
    await signedIn();
    await tab("Move");
    await sleep(4000);
    await shot("50-moves-no-areas");
    for (const [name, sortOrder] of [[NAMES.areaA, 1], [NAMES.areaB, 2]] as const) {
      await m.client.request("POST", `${INV}/locations/${locationId}/storage-areas`, { body: { areaName: name, sortOrder } });
    }
    await launch();
    await tab("Move");
    await waitFor("Nothing moved yet.", 30_000);
    await shot("51-moves-empty");
    await tap("Record a move");
    await waitFor("What moved");
    await shot("52-move-form");
    await pick("What moved", "House", NAMES.shiraz);
    await type("How much", "6");
    await hideKeyboard();
    const from = await findAll(NAMES.areaA);
    await tapAt(Math.round((from[0].x1 + from[0].x2) / 2), Math.round((from[0].y1 + from[0].y2) / 2));
    await sleep(500);
    const to = await findAll(NAMES.areaB);
    const t = to[to.length - 1];
    await tapAt(Math.round((t.x1 + t.x2) / 2), Math.round((t.y1 + t.y2) / 2));
    await shot("52b-move-form-filled");
    await press("Record move");
    await waitGone(/waiting to send/i, 60_000);
    await shot("53-moves-list");
    await setAirplane(true);
    await tap(`Move ${NAMES.shiraz} again`);
    await waitFor("What moved");
    await press("Record move");
    await sleep(3000);
    await shot("54-moves-offline");
    await setAirplane(false);
    await waitGone(/Waiting to send/, 120_000);
  });

  it("count: areas, an area, its review", async () => {
    await signedIn();
    const items = await m.client.request<Array<{ ingredientId: string; ingredientName: string }>>("GET", `${INV}/ingredients`);
    const areas = await m.client.request<Array<{ storageAreaId: string; areaName: string }>>("GET", `${INV}/locations/${locationId}/storage-areas`);
    const ids = (names: string[]) => items.filter((i) => names.includes(i.ingredientName)).map((i) => ({ ingredientId: i.ingredientId }));
    for (const a of areas) {
      await m.client.request("PUT", `${INV}/storage-areas/${a.storageAreaId}/items`, { body: { items: a.areaName === NAMES.areaA ? ids([NAMES.salt, NAMES.long]) : ids([NAMES.shiraz]) } });
    }
    await m.client.request("POST", `${INV}/stock-takes`, { body: { mode: "AREA", categories: areas.map((a) => a.areaName) } });
    await tab("Count");
    await sleep(1000);
    await tab("Count");
    const row = new RegExp(`^${NAMES.areaA}, \\d+ of \\d+ counted`);
    await waitFor(row, 40_000);
    await shot("11-count-areas");
    await tap(row);
    await waitFor(/Count in|Also in|Skip/, 30_000);
    await shot("12-count-area");
    for (const d of ["4", "Decimal point", "5"]) await tapLabel(d);
    await shot("12b-count-area-typed");
    // A typed number that is not saved asks first.
    await tap("Review");
    await waitFor("Discard the number you typed?");
    await shot("12c-count-discard-question");
    await tap(/^keep typing$/i);
    await tap("Save and next");
    await waitFor(new RegExp(`item 2 of 2`));
    await shot("12d-count-area-long-name");
    await tap("Review");
    await waitFor(`Review ${NAMES.areaA}`);
    await sleep(2500); // the count reaches the server
    await shot("13-count-review");
    await press("Submit area");
    const submitted = new RegExp(`^${NAMES.areaA}, .*sent for review`);
    await waitFor(submitted, 30_000);

    // A manager sends the second area for review while the phone is counting it: the phone's count comes back as needs attention.
    const rowB = new RegExp(`^${NAMES.areaB}, \\d+ of \\d+ counted`);
    await tap(rowB);
    await waitFor(/Count in/, 30_000);
    const open = await m.client.request<{ sessionId: string }>("GET", `${INV}/stock-takes/active`);
    const detail = await m.client.request<{ categories: Array<{ categoryName: string; claimRevision: number }> }>("GET", `${INV}/stock-takes/${open.sessionId}`);
    await m.client.request("POST", `${INV}/stock-takes/${open.sessionId}/categories/${encodeURIComponent(NAMES.areaB)}/submit`, { body: { claimRevision: detail.categories.find((x) => x.categoryName === NAMES.areaB)!.claimRevision } });
    await keypad("3");
    await tap("Save and next");
    await waitFor(`Review ${NAMES.areaB}`);
    await sleep(4000);
    await shot("13b-count-review-attention");
    await press("Back to areas");
    await waitFor(/counts? needs? attention/, 60_000);
    await shot("14-count-areas-attention");
    await tap(/counts? needs? attention/);
    await waitFor("Discard this count", 20_000);
    await shot("14b-count-attention");
  });

  it("receive: queue, checklist, short, expiry and lot, wrong price, reject, docket, a shortfall", async () => {
    await signedIn();
    const supplier = (name: string) => m.client.request<{ supplierId: string }>("POST", `${INV}/suppliers`, { body: { supplierName: name, contactPhone: "0400 111 222" } });
    const produce = (await supplier(NAMES.supplier)).supplierId;
    const growers = (await supplier(NAMES.supplierLong)).supplierId;
    const items = await m.client.request<Array<{ ingredientId: string; ingredientName: string }>>("GET", `${INV}/ingredients`);
    const lambId = (await m.client.request<{ ingredientId: string }>("POST", `${INV}/ingredients`, { body: { ingredientName: NAMES.lamb, ingredientCategory: "proteins", baseUnit: "kg", unitCost: "18.00" } })).ingredientId;
    const id = (name: string) => items.find((i) => i.ingredientName === name)!.ingredientId;
    await sentOrder(produce, [{ ingredientId: id(NAMES.salt), qty: "10", cost: "2" }, { ingredientId: id(NAMES.long), qty: "4", cost: "1.5" }, { ingredientId: lambId, qty: "2", cost: "9" }], dayFromNow(-2));
    await sentOrder(growers, [{ ingredientId: lambId, qty: "20", cost: "1.1" }], dayFromNow(1));
    await sentOrder(growers, [{ ingredientId: id(NAMES.salt), qty: "3", cost: "2" }]);
    await tab("Receive");
    const mixed = new RegExp(`^${NAMES.supplier}, order .*, 3 items`);
    await waitFor(mixed, 30_000);
    await shot("91-receive-queue");
    await tap(mixed);
    const salt = new RegExp(`^${NAMES.salt}, 10 kg, Received`);
    await waitFor(salt, 30_000);
    await shot("92-receive-checklist");
    await tap(salt);
    await waitFor("All good");
    await shot("92b-receive-line-open");
    await tap("Short");
    await waitFor("Mark short");
    await keypad("7");
    await shot("92c-receive-short");
    await tap("Mark short");
    await waitFor(new RegExp(`^${NAMES.salt}, Short: 7 of 10 kg`), 30_000);
    await tap(new RegExp(`^${NAMES.salt}, Short: 7 of 10 kg`));
    await tap("Expiry and lot");
    const [y, mo, d] = dayFromNow(21).split("-");
    await type("Expiry date", `${d}/${mo}/${y}`);
    await type("Lot number", "L-4471");
    await hideKeyboard();
    await shot("92f-receive-expiry-lot");
    await press("Save expiry and lot");
    await waitFor(new RegExp(`^${NAMES.salt}, Short: 7 of 10 kg, use by .*, lot L-4471`), 30_000);
    await tap(new RegExp(`^${NAMES.long}, 4 kg, Received`));
    await tap("Wrong price");
    await waitFor("Save price");
    await keypad("1.8");
    await shot("92d-receive-price");
    await tap("Save price");
    await waitFor(new RegExp(`^${NAMES.long}, .*Price changed`), 30_000);
    await tap(new RegExp(`^${NAMES.lamb}, 2 kg, Received`));
    await tap("Reject");
    await waitFor("Reject item");
    await shot("92e-receive-reject");
    await tap("Reject item");
    await waitFor(new RegExp(`^${NAMES.lamb}, Rejected`), 30_000);
    await shot("93-receive-issues");
    await type("Supplier docket number", "D-20931");
    await hideKeyboard();
    await shot("93c-receive-docket");
    await tap("Back to deliveries");
    await waitFor(mixed, 30_000);
    await sleep(1500);
    await shot("93b-receive-queue-in-progress");
    await tap(mixed);
    await tap("Confirm delivery · 3 issues", 30_000);
    await waitFor(/^Delivery received/, 30_000);
    await shot("94-receive-shortfall");
    await tap("Back to deliveries");
  });

  it("ask: a streamed answer, stopped, failed, the list, delete", async () => {
    await signedIn();
    await tab("Ask");
    await tap("New conversation", 30_000);
    await tap("My hollandaise split. How do I fix it?", 20_000);
    await waitFor(/Fake kitchen answer/, 60_000);
    await shot("82-ask-streaming");
    await waitFor("Send", 90_000);
    await shot("82b-ask-answered");
    await typeInto("Your question", "And for forty covers, held for two hours before service starts");
    await shot("82c-ask-keyboard");
    await tap("Send");
    await waitFor(/Fake kitchen answer to: And/, 60_000);
    await tap("Stop");
    await waitFor("Stopped.", 30_000);
    await hideKeyboard();
    await shot("82d-ask-stopped");
    await typeInto("Your question", "This one fails [fake:fail]");
    await tap("Send");
    await waitFor(/couldn't finish this answer|isn't available right now/, 90_000);
    await hideKeyboard();
    await shot("82e-ask-failed");
    await tap("Back to conversations");
    await waitFor(/^My hollandaise split/, 30_000);
    await shot("83-ask-conversations");
    await tap(/^Delete My hollandaise/);
    await sleep(1500);
    await shot("83b-ask-delete-question");
    await tap(/^keep it$/i);
    await tap(/^My hollandaise split/);
    await waitFor(/Fake kitchen answer/, 30_000);
    await shot("84-ask-saved");
  });

  it("recipes: the wait, a made recipe, a refinement, the list", async () => {
    await signedIn();
    await tab("Recipes");
    await tap("Create a recipe", 30_000);
    await waitFor("What would you like to create?", 20_000);
    await type("What would you like to create?", "Chicken braise with cider");
    await hideKeyboard();
    await scrollTo("Generate recipe");
    await shot("86b-recipe-lab-filled");
    await press("Generate recipe");
    await waitFor("Writing your recipe…", 20_000);
    await shot("87-recipe-wait");
    await tap("Stop");
    await waitFor("Stopped. Nothing was saved.", 30_000);
    await shot("87b-recipe-stopped");
    await press("Generate recipe");
    await waitFor(/^who can see it$/i, 90_000);
    await shot("88-recipe");
    await scrollTo(/^method$/i);
    await scroll("down");
    await shot("88b-recipe-method");
    await scrollTo("Make dairy-free");
    await tap("Make dairy-free");
    await hideKeyboard();
    await scrollTo("Refine");
    await shot("88c-recipe-refine");
    await press("Refine");
    await waitFor("Antoine is refining your recipe…", 20_000);
    await shot("88d-recipe-refining");
    await waitFor(/^what changed$/i, 90_000);
    await shot("88e-recipe-proposal");
    await press("Accept changes");
    await sleep(4000);
    await tap("Back to My Recipes");
    await waitFor("Create a recipe", 30_000);
    await sleep(1500);
    await shot("89-recipes-list");
  });

  it("inbox: a list, notification settings, quiet hours", async () => {
    await signedIn();
    const me = await m.client.request<{ userId?: number; user?: { userId: number } }>("GET", "/api/auth/me");
    const userId = me.userId ?? me.user!.userId;
    const ctx = await m.client.request<{ organisationId: number }>("GET", "/api/users/location-context");
    for (const [type, payload, ago] of [
      ["SHIFT_ASSIGNED", {}, "2 minutes"],
      ["DELIVERY_OVERDUE", { poNumber: "PO-2031" }, "3 hours"],
      ["PO_REJECTED", { poNumber: "PO-2030", reason: "Two suppliers quoted less for the same cut this week, please check the Harbour Produce list first" }, "1 day"],
      ["DOCUMENT_EXPIRY_ALERT", { documentType: "Food safety supervisor certificate", staffName: "Sam Lee", expiryDate: "2026-12-20" }, "3 days"],
    ] as const) {
      sql(`insert into notification (organisation_id, recipient_user_id, type, channel, status, payload, sent_at, created_at) values (${Number(ctx.organisationId)}, ${Number(userId)}, '${type}', 'IN_APP', 'SENT', '${JSON.stringify(payload)}', now(), now() - interval '${ago}')`);
    }
    await launch();
    await tap(/^More(,|$)/, 60_000);
    await waitFor(/^Inbox/, 20_000);
    await sleep(2500);
    await shot("96-more-unread");
    await tap(/^Inbox/);
    await waitFor(/PO-2031/, 30_000);
    await shot("96b-inbox-list");
    await scrollTo("Notification settings");
    await shot("96c-inbox-list-end");
    await press("Notification settings");
    await waitFor(/^what to push$/i, 30_000);
    await shot("97-notification-settings");
    await scrollTo("Set quiet hours");
    await shot("97b-notification-settings-quiet");
    await type("From", "9");
    await hideKeyboard();
    await shot("97c-notification-settings-error");
    await scrollToEnd();
    await tap("Back");
  });

  it("account screens: details, kitchen profile, password, two-step", async () => {
    await signedIn();
    await accountRow("My details");
    await waitFor("Choose photo", 30_000);
    await shot("65-my-details");
    await scrollToEnd();
    await shot("65b-my-details-end");
    await tap("Back");
    await accountRow("Kitchen profile");
    await waitFor(/^skill level$/i, 30_000);
    await shot("66-kitchen-profile");
    await scrollTo(/^price of a main course$/i);
    await shot("66b-kitchen-profile-restaurant");
    await scrollToEnd();
    await shot("66c-kitchen-profile-end");
    await tap("Back");
    await accountRow("Password");
    await waitFor("Current password", 30_000);
    await shot("67-password");
    await type("Current password", "not-the-password");
    await type("New password", "Long-enough-1!");
    await hideKeyboard();
    await press("Change password");
    await sleep(3000);
    await shot("67b-password-error");
    await press("Cancel");
    await accountRow("Two-step verification");
    await waitFor("On for your account", 30_000);
    await shot("68-two-step-on");
    await tap("Turn off");
    await waitFor("Authenticator code");
    await shot("68b-two-step-turn-off");
    await tap("Cancel");
    await tap("Back");
    // The set-up steps show only while two-step is off: off in the walk's own database, and back on as it was whatever happens.
    const email = credentials.email.replace(/'/g, "''");
    sql(`update "user" set mfa_enabled_ind = false where user_email = '${email}'`);
    try {
      await accountRow("Two-step verification");
      await waitFor("Set up", 30_000);
      await shot("68c-two-step-off");
      await tap("Set up");
      await waitFor("Continue");
      await type("Your password", credentials.password);
      await hideKeyboard();
      await tap("Continue");
      await waitFor("Open in authenticator app", 30_000);
      await sleep(1500);
      await shot("68d-two-step-set-up");
      await scrollToEnd();
      await shot("68e-two-step-set-up-end");
    } finally {
      sql(`update "user" set mfa_enabled_ind = true, mfa_secret = '${credentials.totpSecret}' where user_email = '${email}'`);
    }
  });

  /** Press a menu control by its label, scrolled clear of the tab bar first: a button half under the fold is in the dump, but a tap there misses it. */
  async function choose(label: string | RegExp) {
    const [w, h] = /(\d+)x(\d+)/.exec(adb(["shell", "wm", "size"]).trim().split("\n").pop()!)!.slice(1).map(Number);
    let lastY = -1;
    for (let i = 0; i < 14; i++) {
      // A control under the fold is listed with what shows of it, or with no height at all: not one to tap.
      const node = (await dump()).find((n) => n.clickable && n.y2 - n.y1 > h * 0.02 && (typeof label === "string" ? n.desc === label : label.test(n.desc)));
      if (node && (node.y2 < h * 0.8 || node.y1 === lastY)) return tapAt(Math.round((node.x1 + node.x2) / 2), Math.round((node.y1 + node.y2) / 2));
      lastY = node ? node.y1 : -1;
      await hideKeyboard();
      const [from, to] = i < 7 ? [0.7, 0.4] : [0.35, 0.65]; // down the page, then back up
      await swipe(Math.round(w / 2), Math.round(h * from), Math.round(w / 2), Math.round(h * to), 300);
      await sleep(800); // a list still gliding takes the next tap as "stop"
    }
    throw new Error(`no control labelled ${label}`);
  }

  /** A menu with every class, a pack, an item over its target and one nobody has costed. Made once per form. */
  function assertThrowawayServer() {
    const db = new URL(process.env.DATABASE_URL ?? "");
    if (!["127.0.0.1", "localhost"].includes(new URL(API_URL).hostname) || db.hostname !== "127.0.0.1" || db.port !== "55432") throw new Error(`not the local test cluster: ${API_URL}, ${db.host}`);
    return db;
  }

  async function seedMenu() {
    const url = assertThrowawayServer();
    if ((await m.client.request<{ name: string }[]>("GET", "/api/menu/items")).some((i) => i.name === "Margherita")) return;
    const ing = async (name: string, baseUnit: string, unitCost: string) => (await m.client.request<{ ingredientId: string }>("POST", `${INV}/ingredients`, { body: { ingredientName: name, ingredientCategory: "dry_goods", baseUnit, unitCost } })).ingredientId;
    const mozzarella = await ing("Fior di latte mozzarella", "kg", "14.00");
    const flour = await ing("Tipo 00 flour", "kg", "2.40");
    const wagyu = await ing("Wagyu rump cap", "kg", "62.00");
    const dish = async (name: string, category: string, sellingPrice: string, sold: number, lines: [string, string, string, string][], over: object = {}) => {
      const { menuItemId } = await m.client.request<{ menuItemId: string }>("POST", "/api/menu/items", { body: { name, category, sellingPrice, ...over } });
      for (const [ingredientId, ingredientName, quantity, unit] of lines) await m.client.request("POST", `/api/menu/items/${menuItemId}/ingredients`, { body: { ...(ingredientId ? { ingredientId } : { unitCost: "3.00" }), ingredientName, quantity, unit } });
      if (sold) await m.client.request("POST", `/api/menu/items/${menuItemId}/sales`, { body: { qtySold: sold, locationId } });
    };
    await dish("Margherita", "Pizza", "24.00", 40, [[mozzarella, "Fior di latte mozzarella", "120", "g"], [flour, "Tipo 00 flour", "160", "g"], ["", "Basil", "0.01", "kg"]]);
    await dish("Wagyu rump cap, burnt onion, bone marrow butter and pickled mustard seed", "Grilled", "58.00", 6, [[wagyu, "Wagyu rump cap", "0.42", "kg"]]);
    await dish("Focaccia", "Sides", "9.00", 30, [[flour, "Tipo 00 flour", "1.2", "kg"]], { servings: 8, qFactorPct: "5" });
    await dish("Dozen dinner rolls", "Sides", "15.00", 2, [[flour, "Tipo 00 flour", "0.9", "kg"]], { servings: 12, servingsPerSale: 12 });
    await m.client.request("PUT", "/api/menu/categories/Grilled", { body: { targetFoodCostPct: "32" } });
    // A saved recipe: only the model makes one through the API, so straight into the walk's own throwaway database, never any other.
    const recipeData = JSON.stringify({ yield: "4 servings", ingredients: [{ name: "Potato", amount: "1", unit: "kg" }, { name: "Tipo 00 flour", amount: "1 1/2", unit: "cups" }, { name: "Salt", amount: "to taste", unit: "pinch" }] });
    execFileSync("psql", [url.href, "-qAt", "-v", "ON_ERROR_STOP=1", "-c", `insert into recipe (user_id, domain, title, recipe_data) select user_id, 'recipe', 'Potato gnocchi', '${recipeData}' from "user" where user_email = '${credentials.email}'`]);
  }

  it("menu: list, filter, item, change it, add one, sale, sales, targets, offline", async () => {
    await signedIn();
    await tab("Menu");
    await waitFor("French onion soup", 30_000);
    await shot("m0-menu-one-item");
    await seedMenu();
    await launch();
    await tab("Menu");
    await waitFor("Dozen dinner rolls", 60_000);
    await shot("m1-menu");
    await choose("Pizza");
    await choose("Star");
    await shot("m1b-menu-filtered");
    await choose("Pizza");
    await choose("Star");
    await type("Search the menu", "wagyu");
    await hideKeyboard();
    await shot("m1c-menu-long-name");
    await choose(/^Wagyu rump cap/);
    await waitFor("Contribution margin", 30_000);
    await shot("m2-item-over-target");
    await choose("Back to the menu");
    await type("Search the menu", "margh");
    await hideKeyboard();
    await choose(/^Margherita, Pizza/);
    await waitFor("Fior di latte mozzarella", 30_000);
    await shot("m2b-item");
    await choose("Change the item");
    await waitFor("Item name", 30_000);
    await shot("m3-change-item");
    await choose("Fior di latte mozzarella, 120 g, $1.68");
    await shot("m3b-line-open");
    await choose("Cancel");
    await choose("Back to the menu");
    await choose("Add a menu item");
    await waitFor("Start from a recipe", 30_000);
    await shot("m4-add-item");
    await choose("Save the item");
    await sleep(800);
    await shot("m4b-add-item-error");
    await choose("Start from a recipe");
    await waitFor("Potato gnocchi", 30_000);
    await shot("m4c-start-from-recipe");
    await choose("Start from Potato gnocchi");
    await type("Selling price, in $", "22");
    await hideKeyboard();
    await choose(/^Salt, no quantity/);
    await shot("m4d-imported-line-open");
    await choose("Remove Salt");
    await choose("Cancel");
    await choose("Record a sale");
    await waitFor("What was sold", 30_000);
    await shot("m5-sale");
    await type("What was sold", "marg");
    await hideKeyboard();
    await choose("Sell Margherita");
    await type("How many", "3");
    await hideKeyboard();
    await shot("m5b-sale-picked");
    await choose("Record the sale");
    await waitFor("Sale recorded", 30_000);
    await shot("m5c-sale-recorded");
    await choose("Back");
    await choose("Recent sales");
    await waitFor("3 × Margherita", 30_000);
    await shot("m6-sales");
    await choose("Back");
    await choose("Category targets");
    await waitFor("Category targets", 30_000);
    await shot("m7-targets");
    await choose("Back to the menu");
    await setAirplane(true);
    try {
      await tab("Inbox");
      await tab("Menu"); // reads the menu again when it comes into view
      await waitFor(/^You're offline/, 60_000);
      await shot("m8-menu-offline");
      await choose("Record a sale");
      await choose("Sell Margherita");
      await choose("Record the sale");
      await waitFor("This sale is not confirmed", 60_000);
      await shot("m8b-sale-not-confirmed");
    } finally {
      await setAirplane(false);
    }
  });

  it("menu insights: dashboard, matrix, an item's waste, plate P&L, yield variance and recommendations, a sales CSV import", async () => {
    assertThrowawayServer();
    await seedMenu();
    const items = await m.client.request<{ menuItemId: string; name: string }[]>("GET", "/api/menu/items");
    const margherita = items.find((i) => i.name === "Margherita")!.menuItemId;
    const lines = await m.client.request<{ ingredientId: string | null; ingredientName: string }[]>("GET", `/api/menu/items/${margherita}/ingredients`);
    const mozzarella = lines.find((l) => l.ingredientName === "Fior di latte mozzarella")!.ingredientId!;
    // Waste of an ingredient, and usage logged for the dish over a sales period: the waste and yield variance figures. The period has no
    // route (only the database sets it), so straight into the walk's own throwaway database.
    await m.client.request("POST", "/api/waste", { body: { storeLocationId: locationId, ingredientName: "Fior di latte mozzarella", quantity: 2, unit: "kg", reason: "Spoilage", estimatedCost: 28, loggedAt: new Date().toISOString() } });
    await m.client.request("POST", `${INV}/consumption-logs`, { body: { storeLocationId: locationId, ingredientId: mozzarella, menuItemId: margherita, quantity: "5.6", unit: "kg", reason: "kitchen_operations" } });
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    sql(`update menu_item set period_start = '${day(-7)}', period_end = '${day(1)}' where menu_item_id = '${margherita}'`);
    // A CSV in the emulator's Downloads, for the system's document picker.
    mkdirSync(OUT, { recursive: true });
    const csv = resolve(OUT, "menu-sales.csv");
    writeFileSync(csv, "item,quantity\nMargherita,2\nFocaccia,1\nCalzone,3\n");
    adb(["push", csv, "/sdcard/Download/menu-sales.csv"]);
    adb(["shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", "file:///sdcard/Download/menu-sales.csv"]);

    await signedIn();
    await tab("Menu");
    await waitFor("Dozen dinner rolls", 60_000);
    await shot("m10-menu-waste");
    await choose("Dashboard");
    await waitFor(/^Items analysed/, 30_000);
    await shot("m10b-dashboard");
    await scroll("down");
    await shot("m10c-dashboard-more");
    await choose("Recalculate");
    await waitFor("Every item was priced again and classified.", 60_000);
    await shot("m10d-dashboard-recalculated");
    await choose("Engineering matrix");
    await waitFor("Engineering matrix", 30_000);
    await shot("m11-matrix");
    await choose(/^Margherita: margin/);
    await waitFor("Open Margherita", 30_000);
    await shot("m11b-matrix-picked");
    await choose("Open Margherita");
    await waitFor(/^Price per serving/, 30_000);
    await shot("m12-item-figures");
    await scroll("down");
    await shot("m12b-item-variance");
    await choose("Get recommendations");
    await waitFor(/^Made by the fake model/, 60_000); // "Ask again" is below the fold
    await shot("m12c-item-recommendations");
    await choose("Write a replacement recipe");
    await waitFor("What would you like to create?", 30_000);
    await shot("m12d-replacement-in-recipe-lab");
    await tab("Menu");
    await choose("Record a sale");
    await choose("Import sales from a CSV");
    await waitFor("Import sales", 30_000);
    await shot("m13-import-sales");
    await choose("Choose a CSV file");
    await sleep(4000);
    await shot("m13b-document-picker");
    await tap("menu-sales.csv", 30_000);
    await waitFor(/^2 matched/i, 60_000); // a copper capitals label
    await shot("m13c-import-matched");
    await choose("Record 2 sales");
    await waitFor("2 recorded", 60_000);
    await shot("m13d-import-recorded");
    // Nothing of the file is kept by the app.
    const kept = adb(["shell", "run-as com.culinairekitchen.chef sh -c 'find . -name \"*.csv\" 2>/dev/null | wc -l'"]).trim();
    if (kept !== "0") throw new Error("the app kept a copy of the CSV");
    adb(["shell", "rm", "-f", "/sdcard/Download/menu-sales.csv"]);
  });

  it("brain: warming up, a list, an open memory, remove, shared, no match, nudges, offline", async () => {
    await signedIn();
    const me = await m.client.request<{ userId?: number; user?: { userId: number } }>("GET", "/api/auth/me");
    const userId = Number(me.userId ?? me.user!.userId);
    const organisationId = Number((await m.client.request<{ organisationId: number }>("GET", "/api/users/location-context")).organisationId);
    await tab("Brain");
    await waitFor("Your Brain is warming up", 30_000);
    await shot("b0-brain-empty");
    // The server writes memories itself (its Brain flags are off here), so straight into the walk's own throwaway database.
    sql(`insert into brain_memory (user_id, organisation_id, scope, source_type, title, body, status, is_pinned, created_dttm)
      select ${userId}, o, s, t, n, b, st, p, now() - a::interval from (values
      (null::int, 'user', 'chat', 'Salt fish overnight', 'You cure kingfish overnight at 2.5% salt before the ceviche goes on the specials board. Two hours was not enough in the March tasting.', 'ready', true, '20 days'),
      (null, 'user', 'recipe', 'Cider-braised chicken thighs with prunes, speck and a very long name that has to wrap', 'You keep the skin crisp by finishing under the salamander.', 'ready', false, '3 days'),
      (null, 'user', 'chat', null, 'Antoine suggested toasting the flour for the roux so it never tastes raw, even on a short cook.', 'pending', false, '2 minutes'),
      (null, 'user', 'prep', 'Saturday prep', 'Onions for the soup take one cook a full hour.', 'ready', false, '5 days'),
      (${organisationId}, 'org', 'waste', 'Herbs thrown out on Mondays', 'Three Mondays running, coriander and dill were binned after the weekend delivery.', 'ready', false, '1 day')) v(o, s, t, n, b, st, p, a)`);
    await tap(/^More(,|$)/);
    await waitFor("Brain", 20_000);
    await scrollToEnd();
    await shot("b1a-more");
    await tab("Inbox");
    await tab("Brain");
    await waitFor("4 memories", 30_000);
    await shot("b1-brain");
    await scrollToEnd();
    await shot("b1b-brain-end");
    await choose(/^Salt fish overnight/);
    await waitFor("Remove", 20_000);
    await shot("b2-memory-open");
    await choose("Remove");
    await waitFor(/^keep it$/i, 20_000);
    await shot("b2b-remove-asked");
    await tap(/^keep it$/i);
    await choose(/^Salt fish overnight/); // closed again: one Remove on screen
    await choose(/^Saturday prep/);
    await choose("Remove");
    await tap(/^remove$/i);
    await waitFor("3 memories", 30_000);
    if (sql(`select count(*) from brain_memory where title = 'Saturday prep'`) !== "0") throw new Error("the memory is still on the server");
    await choose("Proactive nudges");
    await sleep(1500);
    await shot("b3-nudges-on");
    if (sql(`select brain_nudges_opt_in from "user" where user_id = ${userId}`) !== "t") throw new Error("nudges were not switched on");
    await choose("Shared");
    await waitFor("Herbs thrown out on Mondays", 30_000);
    await shot("b4-shared");
    await choose("Private to you");
    await waitFor("3 memories", 30_000);
    await type("Search", "truffle");
    await hideKeyboard();
    await waitFor("No memories match", 30_000);
    await shot("b5-no-match");
    await launch();
    await tab("Brain");
    await waitFor("3 memories", 60_000);
    await setAirplane(true);
    try {
      await tab("Inbox");
      await tab("Brain"); // reads the memories again when it comes into view
      await waitFor(/^Can't reach the server/, 60_000);
      for (let i = 0; i < 6; i++) await scroll("up");
      await shot("b6-brain-offline");
    } finally {
      await setAirplane(false);
    }
  });

  it("bench: list, a kitchen's channel, a message open, mention, people, pins, search, edit, everyone, a direct message, not sent, refused by the word filter, everyone without pins", async () => {
    const ctx = await m.client.request<{ organisationId: number }>("GET", "/api/users/location-context");
    const { organisation } = await m.client.request<{ organisation: { joinKey: string } }>("GET", "/api/organisations/mine");
    const me = Number((await m.client.request<{ userId?: number; user?: { userId: number } }>("GET", "/api/auth/me").then((r) => r.userId ?? r.user!.userId)));
    const key = `org_${Number(ctx.organisationId)}`;
    // A colleague who writes back: their own sign-in and their own live connection. The Everyone channel is not seeded.
    let theirs: Tokens | null = null;
    const colleague = createApiClient({ baseUrl: API_URL, appVersion: "0.1.0-device", tokenStore: { load: async () => theirs, save: async (t) => void (theirs = t), clear: async () => void (theirs = null) } });
    const email = `walk-bench-${FORM}-${Date.now().toString(36)}@culinaire.test`;
    await colleague.request("POST", "/api/auth/register", { auth: false, body: { name: "Bo Li", email, password: "Walk-Bench-Pass-1!" } });
    const login = await colleague.request<{ tokens: Tokens; user: { userId: number } }>("POST", "/api/auth/login", { auth: false, body: { email, password: "Walk-Bench-Pass-1!" } });
    theirs = login.tokens;
    const bo = Number(login.user.userId);
    await colleague.request("POST", "/api/organisations/join", { body: { joinKey: organisation.joinKey } });
    await colleague.request("GET", "/api/bench/channels");
    sql(`insert into bench_channel (channel_key, channel_name, channel_type) values ('everyone', 'Everyone', 'global') on conflict do nothing`);
    const line = (channel: string, who: number, body: string, ago: string) => sql(`insert into bench_message (channel_id, user_id, message_body, created_dttm) select channel_id, ${who}, '${body}', now() - interval '${ago}' from bench_channel where channel_key = '${channel}'`);
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) line(key, me, `Order kingfish for ${day}, two boxes and the trim for staff lunch`, "4 days");
    line(key, bo, "Morning. Two boxes of kingfish came in, one is short by 800 g. I have set it aside with the docket so Receiving can weigh it again before the driver leaves.", "1 day 2 hours");
    line(key, me, "Thanks. I will call them.", "1 day 1 hour");
    line(key, bo, "Walk-in is at 6 degrees, the compressor has been told off.", "40 minutes");
    line("everyone", bo, "Anyone in Melbourne with a spare dough divider for Saturday?", "3 hours");
    // A made-up term on the word list. The server reads the list again a minute after its last read at most.
    sql(`insert into site_setting (setting_key, setting_value) values ('bench.blocked_terms', 'zorp') on conflict (setting_key) do update set setting_value = excluded.setting_value`);
    const listed = Date.now();
    let socket: Socket | null = null;
    try {
      socket = io(API_URL, { transports: ["websocket"], auth: { token: login.tokens.accessToken } });
      // A moment after connecting: a join is not acknowledged.
      socket.on("connect", () => setTimeout(() => socket!.emit("bench:join", { channelKey: key }), 1_500));
      await signedIn();
      await tab("Bench");
      await waitFor("The Bench", 30_000);
      await waitFor(/^Everyone/, 30_000);
      await shot("c0-bench-list");
      const kitchenName = sql(`select channel_name from bench_channel where channel_key = '${key}'`);
      await tap(kitchenName);
      await waitFor(/compressor has been told off/, 30_000);
      await shot("c1-kitchen");
      socket.emit("bench:typing", { channelKey: key });
      await waitFor("Bo Li is writing…", 5_000).catch(() => null);
      await shot("c1b-kitchen-writing");
      await tap(/compressor has been told off/);
      await waitFor("React Fire", 20_000);
      await shot("c2-message-open");
      await tap("React Fire");
      await sleep(1500);
      await tap(/compressor has been told off/);
      await tap("Pin");
      await sleep(1500);
      await tapNow("Pinned");
      await waitFor(/^Unpin Bo Li/, 20_000);
      await shot("c3-pinned");
      await tapNow("Pinned");
      await tapNow(/on the pass$/);
      await waitFor("Message Bo Li", 20_000);
      await shot("c4-people");
      await tapNow(/on the pass$/);
      await tapNow("Search");
      await type("Search this channel", "kingfish");
      await sleep(1500);
      await shot("c5-search-keyboard");
      await hideKeyboard();
      await tapNow("Search");
      await type("Your message", "Ask @b");
      await waitFor("Mention Bo Li", 20_000);
      await shot("c6-mention-keyboard");
      await tapNow("Mention Bo Li");
      await hideKeyboard();
      await tapNow("Send");
      await waitFor(/^Ask @Bo Li/, 20_000);
      await sleep(1500);
      await shot("c7-posted");
      await tap(/Ask @Bo Li/);
      await tap("Edit");
      await waitFor("Edit your message", 20_000);
      await hideKeyboard();
      await shot("c7b-edit");
      await tapNow("Cancel");
      await setAirplane(true);
      try {
        await waitFor(/^Not connected/, 90_000);
        await type("Your message", "On my way down");
        await hideKeyboard();
        await tapNow("Send");
        await waitFor("Not sent.", 20_000);
        await shot("c8-not-sent");
      } finally {
        await setAirplane(false);
      }
      await waitGone(/^Not connected/, 90_000);
      await tapNow("Discard");
      await sleep(Math.max(0, listed + 61_000 - Date.now()));
      await type("Your message", "Is the zorp in yet?");
      await hideKeyboard();
      await tapNow("Send");
      await waitFor("This message can't be posted.", 20_000);
      await shot("c8b-refused");
      if (await has("Back to the Bench")) await tapNow("Back to the Bench");
      await tap(/^Everyone/);
      await waitFor(/dough divider/, 30_000);
      await shot("c9-everyone");
      if (await has("Back to the Bench")) await tapNow("Back to the Bench");
      socket.emit("bench:dm:send", { recipientId: me, body: "Can you cover the pass from two?" });
      await waitFor("Bo Li, new message", 30_000);
      await shot("c10-list-new-message");
      await tap("Bo Li, new message");
      await waitFor(/cover the pass/, 30_000);
      await shot("c11-direct-message");
      // Report and block: the direct message's header offers both.
      await tapNow("Report");
      await waitFor("Send report", 20_000);
      await tapLabel("Harassment or bullying");
      await shot("c13-report-form");
      await tapNow("Send report");
      await waitFor(/A moderator will look at it/, 20_000);
      await shot("c14-report-sent");
      await tapNow("Block");
      await waitFor("Block Bo Li?", 20_000);
      await shot("c15-block-asks");
      await tapNow(/^cancel$/i); // the block itself is made through the API: Back does not close this dialog
      await m.client.request("POST", "/api/bench/blocks", { body: { userId: bo } });
      if (await has("Back to the Bench")) await tapNow("Back to the Bench");
      await tap("Blocked people");
      await waitFor("Unblock Bo Li", 20_000);
      await shot("c16-blocked-people");
      await tapNow("Back to the Bench");
      await tap("Reports to review"); // the walk's user is an Administrator
      await waitFor(/^Reported by/, 20_000);
      await shot("c17-reports");
      await m.client.request("DELETE", `/api/bench/blocks/${bo}`);
      // Someone who is not an administrator: Everyone's message offers reactions, and no Pin.
      const administrator = sql(`select role_id from role where role_name = 'Administrator'`);
      sql(`delete from user_role where user_id = ${me} and role_id = ${administrator}`);
      try {
        await signedIn();
        await tab("Bench");
        await tap(/^Everyone/);
        await waitFor(/dough divider/, 30_000);
        await tap(/dough divider/);
        await waitFor("React Fire", 20_000);
        await shot("c12-everyone-not-administrator");
      } finally {
        sql(`insert into user_role (user_id, role_id) values (${me}, ${administrator})`);
      }
    } finally {
      socket?.disconnect();
      forceStop(); // the next form starts a server and a database of its own
    }
  });

  it("account, change location, delete account form", async () => {
    await signedIn();
    const me = await m.client.request<{ userId?: number; user?: { userId: number } }>("GET", "/api/auth/me");
    const userId = me.userId ?? me.user!.userId;
    await m.client.request("POST", `/api/store-locations/${await secondLocation()}/staff`, { body: { userId } });
    await launch();
    await waitFor(/^More(,|$)|^Account(,|$)/, 60_000);
    if (await has(/^More(,|$)/)) {
      await tap(/^More(,|$)/);
      await waitFor("More");
      await shot("61-more");
    }
    await tab("Account");
    await waitFor("My details", 30_000);
    await shot("60-account");
    await tap("Change location");
    await waitFor("Where are you working?", 20_000);
    await shot("62-location");
    await tap("Cancel");
    await tab("Account");
    await tap("Delete my account");
    await sleep(2500);
    await shot("63-delete-account");
    await tap("Cancel");
  });

  it("transfers: the list, a receive, one to send, a new one, offline", async () => {
    await stockRoom();
    await signedIn();
    await tab("Transfers");
    await waitFor(/^to receive$/i, 30_000);
    await shot("55b-transfers-list");
    await tap(new RegExp(`^From ${NAMES.location2}, 2 items, On its way`));
    await waitFor(/^what arrived$/i, 30_000);
    await type(`${NAMES.tonic} received, in each`, "8");
    await hideKeyboard();
    await waitFor("Short by 2 each");
    await shot("56-transfer-receive");
    await press("Back to transfers");
    await tap(new RegExp(`^To ${NAMES.location2}, 1 item`));
    await scrollTo("Send now");
    await shot("56b-transfer-to-send");
    await press("Back to transfers");
    await press("New transfer");
    await waitFor(/^going to$/i);
    await shot("57-transfer-new");
    await press("Send now");
    await sleep(1000);
    await shot("57b-transfer-new-error");
    await tapLabel(NAMES.location2);
    await pick("Add an item", "Tonic", NAMES.tonic);
    await type(`How much ${NAMES.tonic}, in each`, "2");
    await hideKeyboard();
    await shot("57c-transfer-new-filled");
    await setAirplane(true);
    await press("Send now");
    await waitFor(/waiting to send/i, 30_000);
    await sleep(2500);
    await shot("57d-transfers-offline");
    await setAirplane(false);
    await waitGone(/waiting to send/i, 120_000);
  });

  it("stock: the figures, an item, the lookup, a request", async () => {
    await stockRoom();
    await signedIn();
    await tab("Stock");
    await waitFor(/^Critical, reorder now/, 30_000);
    await shot("45b-stock");
    await tap(/^Critical, reorder now/);
    await waitFor(new RegExp(`^${NAMES.gin}, on hand`));
    await shot("46-stock-critical-open");
    await scrollToEnd();
    await shot("46b-stock-end");
    await scrollTo(new RegExp(`^${NAMES.gin}, on hand`));
    await tap(new RegExp(`^${NAMES.gin}, on hand`));
    await waitFor(/^kept in$/i);
    await sleep(1500); // its stock at every location comes from the server
    await shot("47-stock-item");
    await scrollToEnd();
    await shot("47b-stock-item-end");
    await press("Back");
    await press("My requests");
    await waitFor("You haven't asked for a new item yet.", 20_000);
    await shot("49c-stock-requests-empty");
    await press("Back");
    await press("Look up an item");
    await type("Search the catalogue", "to");
    await hideKeyboard();
    await shot("48-stock-lookup");
    await type("Search the catalogue", "yuzu");
    await hideKeyboard();
    await shot("48b-stock-lookup-nothing");
    await press("Not in the catalogue? Ask for it");
    await waitFor("Ask for a new item");
    await tapLabel("Kitchen Ingredient");
    await tapLabel("Beverages");
    await type("Unit it's counted in (optional)", "L");
    await type("How many you have now (optional)", "2");
    await hideKeyboard();
    await shot("49-stock-request");
    await press("Send request");
    await waitFor("My requests", 30_000);
    await sleep(3000); // the queue sends it: "Sent for review"
    await shot("49b-stock-requests");
  });

  it("first run: join by key, wrong key", async () => {
    await toSignIn();
    await typePassword(process.env.E2E_DELETE_USER_EMAIL ?? "", process.env.E2E_DELETE_USER_PASSWORD ?? "");
    await submitSignIn();
    await waitFor("Join your kitchen", 30_000);
    await shot("70-first-run");
    await type("Join key", "NOT-A-KEY");
    await hideKeyboard();
    await tap("Join");
    await sleep(2500);
    await shot("71-first-run-error");
    const key = sql("select o.join_key from organisation o where o.organisation_name = 'E2E Kitchen'");
    await type("Join key", key);
    await hideKeyboard();
    await press("Join");
    await waitFor("Join your location", 30_000);
    await shot("72-first-run-location");
    await press("Sign out");
    await waitFor("Welcome back to the line.", 20_000);
  });

  // A person who reads the menu without inventory:cost. Takes every other key off the Subscriber role of the throwaway database, and leaves
  // the organisation again: its only admin, deleted next, could not go while it has another member.
  it("menu without costs: list, item, sale", async () => {
    assertThrowawayServer();
    await seedMenu();
    const { permissions } = await m.client.request<{ permissions: { permissionId: number; permissionKey: string }[] }>("GET", "/api/permissions");
    const { roles } = await m.client.request<{ roles: { roleId: number; roleName: string; permissions: { permissionId: number }[] }[] }>("GET", "/api/roles");
    const subscriber = roles.find((r) => r.roleName === "Subscriber")!;
    const setSubscriber = (permissionIds: number[]) => m.client.request("PUT", `/api/roles/${subscriber.roleId}/permissions`, { body: { permissionIds } });
    const { organisation } = await m.client.request<{ organisation: { organisationId: number; joinKey: string } }>("GET", "/api/organisations/mine");
    const [email, password] = [process.env.E2E_DELETE_USER_EMAIL ?? "", process.env.E2E_DELETE_USER_PASSWORD ?? ""];
    const cook = await m.client.request<{ user: { userId: number }; tokens: Tokens }>("POST", "/api/auth/login", { auth: false, body: { email, password } });
    const asCook = createApiClient({ baseUrl: API_URL, appVersion: "0.1.0-device", tokenStore: { load: async () => cook.tokens, save: async () => {}, clear: async () => {} } });
    await asCook.request("POST", "/api/organisations/join", { body: { joinKey: organisation.joinKey } });
    try {
      await setSubscriber(permissions.filter((p) => p.permissionKey === "menu:read").map((p) => p.permissionId));
      await m.client.request("POST", `/api/store-locations/${locationId}/staff`, { body: { userId: cook.user.userId } });
      await toSignIn();
      await typePassword(email, password);
      await submitSignIn();
      await tab("Menu");
      await waitFor("Dozen dinner rolls", 60_000);
      await shot("m9-menu-no-costs");
      await type("Search the menu", "margh");
      await hideKeyboard();
      await choose(/^Margherita, Pizza/);
      await waitFor("Fior di latte mozzarella", 30_000);
      await shot("m9b-item-no-costs");
      await choose("Record a sale");
      await choose("Record the sale");
      await waitFor("Sale recorded", 30_000);
      await shot("m9c-sale-no-costs");
      await choose("Back");
      await choose("Back to the menu");
      await choose("Dashboard");
      await waitFor(/^Items analysed/, 30_000);
      await shot("m9d-dashboard-no-costs");
    } finally {
      await asCook.request("DELETE", `/api/organisations/${organisation.organisationId}/leave`).catch(() => {});
      await setSubscriber(subscriber.permissions.map((p) => p.permissionId));
    }
  });

  it("delete account, then the goodbye screen", async () => {
    await signedIn();
    await tab("Account");
    await tap("Delete my account");
    await waitFor("Delete your account?", 30_000);
    if (await find("Your password", (n) => n.find((x) => x.cls.includes("EditText")))) await type("Your password", credentials.password);
    if (await find("Your email", (n) => n.find((x) => x.cls.includes("EditText")))) await type("Your email", credentials.email);
    if (await find("Authenticator code", (n) => n.find((x) => x.cls.includes("EditText")))) await type("Authenticator code", await freshCode());
    await hideKeyboard();
    await shot("63b-delete-account-filled");
    const del = await findAll(/^Delete/);
    const b = del[del.length - 1];
    await tapAt(Math.round((b.x1 + b.x2) / 2), Math.round((b.y1 + b.y2) / 2));
    await sleep(1500);
    if (await has(/^Delete$/i)) await tap(/^Delete$/i);
    await sleep(4000);
    await shot("64-account-deleted");
  });
});

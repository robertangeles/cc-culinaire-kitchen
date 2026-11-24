import { describe, it, beforeAll, afterAll, beforeEach, onTestFailed } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  adb, back, clearApp, dismissSavePassword, openTab, dump, fieldText, find, isSavePasswordSheet, findAll, forceStop, has, hideKeyboard, openApp, setAirplane, setAnimations, setDarkMode, setFontScale,
  setRotation, swipe, tap, tapAt, tapLabel, typeInto, waitFor, waitGone,
} from "./adb";
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
  const [w, h] = /(\d+)x(\d+)/.exec(adb(["shell", "wm", "size"]).trim().split("\n").pop()!)!.slice(1).map(Number);
  const dpi = Number(/(\d+)\s*$/.exec(adb(["shell", "wm", "density"]).trim())![1]);
  await tap("Tools");
  try {
    // The menu opens half-height, with the switch under the navigation bar: drag it up until the row is well on screen.
    for (let i = 0; i < 3; i++) {
      // The menu does not always show the row in time: leave the gear in the picture rather than fail the walk.
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
    const field = await find(label, (n) => n.find((x) => x.cls.includes("EditText")));
    if (!field) {
      // Scrolled past it (a long form after its button was pressed): scroll back up.
      await hideKeyboard();
      const [w, h] = /(\d+)x(\d+)/.exec(adb(["shell", "wm", "size"]).trim().split("\n").pop()!)!.slice(1).map(Number);
      await swipe(Math.round(w / 2), Math.round(h * 0.3), Math.round(w / 2), Math.round(h * 0.8), 300);
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

/** Tap a button by its label, scrolling down to it: a long form's button starts below the screen, under a title with the same words. */
async function press(label: string) {
  for (let i = 0; i < 6; i++) {
    const button = (await dump()).find((n) => n.desc === label && n.clickable);
    if (button) return tapAt(Math.round((button.x1 + button.x2) / 2), Math.round((button.y1 + button.y2) / 2));
    await hideKeyboard();
    const [w, h] = /(\d+)x(\d+)/.exec(adb(["shell", "wm", "size"]).trim().split("\n").pop()!)!.slice(1).map(Number);
    await swipe(Math.round(w / 2), Math.round(h * 0.7), Math.round(w / 2), Math.round(h * 0.3), 300);
  }
  throw new Error(`no button labelled ${label}`);
}

/** Bring a control into view on a long page, then leave it where it is. */
async function scrollTo(label: string | RegExp) {
  for (let i = 0; i < 10; i++) {
    const [w, h] = /(\d+)x(\d+)/.exec(adb(["shell", "wm", "size"]).trim().split("\n").pop()!)!.slice(1).map(Number);
    const node = await find(label);
    if (node && node.y2 < h * 0.85) return;
    await swipe(Math.round(w / 2), Math.round(h * 0.7), Math.round(w / 2), Math.round(h * 0.35), 300);
  }
  if (!(await has(label))) throw new Error(`could not scroll to ${String(label)}`);
}
const scrollToEnd = async () => {
  const [w, h] = /(\d+)x(\d+)/.exec(adb(["shell", "wm", "size"]).trim().split("\n").pop()!)!.slice(1).map(Number);
  for (let i = 0; i < 6; i++) await swipe(Math.round(w / 2), Math.round(h * 0.75), Math.round(w / 2), Math.round(h * 0.2), 200);
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
const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Open one of Account's rows. */
async function accountRow(label: string) {
  await tab("Account");
  await waitFor("Sign out", 30_000);
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

  it("home, ask, recipes, receive, inbox", async () => {
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
    for (let i = 0; i < 11; i++) await tapLabel(`More ${NAMES.dish}`, 2000).catch(() => {});
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

  it("receive: queue, checklist, short, wrong price, reject, a shortfall", async () => {
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
    await tab("Recipes");
    await back().catch(() => {});
    if (!(await has("Create a recipe"))) await tab("Recipes");
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

  it("account, change location, delete account form", async () => {
    await signedIn();
    const me = await m.client.request<{ userId?: number; user?: { userId: number } }>("GET", "/api/auth/me");
    const userId = me.userId ?? me.user!.userId;
    const ctx = await m.client.request<{ organisationId: number }>("GET", "/api/users/location-context");
    const second = await m.client.request<{ storeLocation: { storeLocationId: string } }>("POST", "/api/store-locations", { body: { organisationId: ctx.organisationId, locationName: NAMES.location2 } });
    await m.client.request("POST", `/api/store-locations/${second.storeLocation.storeLocationId}/staff`, { body: { userId } });
    await launch();
    await waitFor(/^More(,|$)|^Account(,|$)/, 60_000);
    if (await has(/^More(,|$)/)) {
      await tap(/^More(,|$)/);
      await waitFor("More");
      await shot("61-more");
    }
    await tab("Account");
    await waitFor("Sign out", 30_000);
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

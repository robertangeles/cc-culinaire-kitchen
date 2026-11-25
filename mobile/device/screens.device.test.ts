import { describe, it, beforeAll, afterAll, beforeEach, onTestFailed } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  adb, back, clearApp, dismissSavePassword, openTab, dump, fieldText, find, isSavePasswordSheet, findAll, forceStop, has, hideKeyboard, openApp, setAirplane, setAnimations, setDarkMode, setFontScale,
  setRotation, swipe, tap, tapAt, tapLabel, typeInto, waitFor, waitGone,
} from "./adb";
import { createApiClient, type Tokens } from "../src/api/client";
import { credentials, freshCode, manager } from "./fixtures";

/**
 * The screenshot walk: every screen of the phone app and its main states (empty, filled, error, offline or queued, long text), photographed
 * for a person to look at. It asserts only that it reached each screen; the look is judged from the images. Run it through `device/screens.sh`,
 * which makes a fresh database, the server and Metro, runs this file once per form factor and writes the gallery.
 *
 * SCREENS_FORM: "phone" (the device as it is), "tablet" (iPad portrait, 820 x 1180 dp) or "tablet-landscape" (1180 x 820 dp). The tablet forms
 * set the phone's display size and density with `wm`, so the real Android runtime lays the app out at iPad width; both are reset afterwards.
 * Images go to SCREENS_OUT/<form>/<name>.png.
 */
const METRO = process.env.METRO_URL ?? "http://127.0.0.1:8088";
const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:3009";
const FORM = process.env.SCREENS_FORM ?? "phone";
const OUT = resolve(process.env.SCREENS_OUT ?? "device/_shots/screens", FORM);
const INV = "/api/inventory";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sdk = process.env.ANDROID_HOME ?? `${process.env.HOME}/Android/Sdk`;

/** Display overrides for the tablet forms, on a 1220 px wide phone: density = 1220 px * 160 / width in dp. */
const DISPLAYS: Record<string, { size: string; density: number } | undefined> = {
  phone: undefined,
  tablet: { size: "1220x1755", density: 238 },
  "tablet-landscape": { size: "1220x846", density: 165 },
};

async function shot(name: string) {
  await sleep(700); // let a transition or a list finish moving
  // Never photograph the save-password sheet: it shows the phone owner's Google account.
  for (let i = 0; i < 3 && (await dismissSavePassword()); i++);
  if (isSavePasswordSheet(await dump())) throw new Error(`not photographing ${name}: the save-password sheet is still on screen`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${name}.png`), execFileSync(process.env.ADB ?? `${sdk}/platform-tools/adb`, ["exec-out", "screencap", "-p"], { maxBuffer: 1 << 26 }));
}

function setDisplay(form: string) {
  const d = DISPLAYS[form];
  adb(["shell", "wm", "size", d ? d.size : "reset"]);
  adb(["shell", "wm", "density", d ? String(d.density) : "reset"]);
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
    await tap("Privacy Policy");
    await sleep(3000);
    await shot("04b-legal-privacy");
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
    await tap("Review");
    await sleep(1500);
    await shot("13-count-review");
    await tap("Back to areas");
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
    await tap("Sign out");
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

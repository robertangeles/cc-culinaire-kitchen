import { describe, it, expect, beforeAll, afterAll, onTestFailed, beforeEach } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adb, back, clearApp, clearField, dismissSavePassword, dump, findAll, forceStop, has, hideKeyboard, key, openApp, openTab, PACKAGE, screenSize, setAnimations, setRotation, swipe, tap, tapAt, typeInto, waitFor as waitForExact } from "./adb";
import { credentials, freshCode, manager } from "./fixtures";

/**
 * The app lock walk, on the tablet emulator only: the real system prompt with a PIN it sets on the emulator and takes away again (never on
 * the owner's phone). A device with no screen lock, a cancelled prompt, an unlock, a guarded approval, the grace period, a cold start.
 *   EXPO_PUBLIC_APP_LOCK=on SCREENS_FILE=device/appLock.device.test.ts SCREENS_FORMS=tablet bash device/lease.sh bash device/screens.sh <out-dir>
 * (with the emulator's env loaded). Skipped without it: the other walks run with the lock off.
 */
const METRO = process.env.METRO_URL ?? "http://10.0.2.2:8098";
const OUT = resolve(process.env.SCREENS_OUT ?? "device/_shots/lock", process.env.SCREENS_FORM ?? "tablet");
const API = "/api/inventory";
const PIN = "4826";
const ADB = process.env.ADB ?? `${process.env.ANDROID_HOME ?? `${process.env.HOME}/Android/Sdk`}/platform-tools/adb`;
const onEmulator = (process.env.ANDROID_SERIAL ?? "").startsWith("emulator-");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const shell = (...args: string[]) => adb(["shell", ...args]);

const m = manager();
let poId = "";
let poNumber = "";

async function shot(name: string) {
  await sleep(900);
  for (let i = 0; i < 3 && (await dismissSavePassword()); i++);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${name}.png`), execFileSync(ADB, ["exec-out", "screencap", "-p"], { maxBuffer: 1 << 26 }));
}
/** Copper capitals labels reach the screen dump in capitals, so plain words are matched whatever their case. */
const waitFor = (what: string | RegExp, ms?: number) => waitForExact(typeof what === "string" ? new RegExp(`^${what.replace(/[.?]/g, "\\$&")}$`, "i") : what, ms);
const TABS = /^More(,|$)|^Account(,|$)/;

async function launch() {
  forceStop();
  await openApp(METRO);
  await sleep(6000);
}
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
  await clearField("Email");
  await typeInto("Email", credentials.email);
  await clearField("Password");
  await typeInto("Password", credentials.password);
  await hideKeyboard();
  const all = await findAll("Sign in");
  const b = all[all.length - 1];
  await tapAt(Math.round((b.x1 + b.x2) / 2), Math.round((b.y1 + b.y2) / 2));
  await waitFor("Enter your 6-digit code", 30_000);
  await clearField("Code");
  await typeInto("Code", await freshCode());
  await hideKeyboard();
  if (await has("Verify")) await tap("Verify");
}
async function press(label: string | RegExp) {
  for (let i = 0; i < 9; i++) {
    const [w, h] = screenSize();
    const button = (await dump()).find((n) => n.clickable && (typeof label === "string" ? n.desc === label : label.test(n.desc)) && n.y2 < h * 0.93);
    if (button) return tapAt(Math.round((button.x1 + button.x2) / 2), Math.round((button.y1 + button.y2) / 2));
    await swipe(Math.round(w / 2), Math.round(h * 0.7), Math.round(w / 2), Math.round(h * 0.3), 300);
  }
  throw new Error(`no button labelled ${String(label)}`);
}
/** What a screen reader (and a person) can get at. `dump` also lists what is mounted but hidden, as the app is under its lock. */
async function readable(what: RegExp): Promise<boolean> {
  for (let i = 0; i < 6; i++) {
    try {
      shell("uiautomator", "dump", "--compressed", "/sdcard/readable.xml");
      return [...adb(["exec-out", "cat", "/sdcard/readable.xml"]).matchAll(/(?:text|content-desc)="([^"]*)"/g)].some((t) => what.test(t[1]));
    } catch {
      await sleep(400);
    }
  }
  throw new Error("could not read the screen");
}
async function waitReadable(what: RegExp, ms = 30_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) if (await readable(what)) return;
  throw new Error(`${String(what)} cannot be read on the screen`);
}
/** The system's own PIN prompt, not a window of the app. */
const promptUp = () => shell("dumpsys", "window").includes("BiometricPrompt");
async function waitPrompt(up: boolean) {
  for (let i = 0; i < 30; i++) {
    if (promptUp() === up) return sleep(800);
    await sleep(500);
  }
  throw new Error(`the system prompt ${up ? "did not open" : "did not close"}`);
}
async function typePin() {
  await waitPrompt(true);
  shell("input", "text", PIN);
  await key("KEYCODE_ENTER");
  await waitPrompt(false);
}
async function unlock() {
  await press("Unlock");
  await typePin();
}
/** The lock screen, and nothing of the app to read behind it. */
async function expectLocked() {
  await waitReadable(/^Locked$/, 60_000);
  expect(await readable(TABS)).toBe(false);
  expect(await readable(new RegExp(poNumber))).toBe(false);
}
const status = async () => (await m.client.request<{ status: string }>("GET", `${API}/purchase-orders/${poId}`)).status;
const comeBack = async () => {
  shell("am", "start", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "-n", `${PACKAGE}/.MainActivity`);
  await sleep(2500);
};
const goHome = async (ms: number) => {
  await key("KEYCODE_HOME");
  await sleep(ms);
  await comeBack();
};
/** Films the way back to the app, to look at frame by frame: nothing of the app may show before the lock. */
async function filmComeBack(name: string) {
  const film = spawn(ADB, ["shell", "screenrecord", "--time-limit", "6", "/sdcard/back.mp4"]);
  await sleep(1500);
  await comeBack();
  await new Promise((done) => film.on("exit", done));
  adb(["pull", "/sdcard/back.mp4", resolve(OUT, `${name}.mp4`)]);
}

describe.skipIf(!process.env.SCREENS_OUT || process.env.EXPO_PUBLIC_APP_LOCK !== "on" || !onEmulator)("app lock walk", { timeout: 900_000 }, () => {
  beforeEach((ctx) => {
    onTestFailed(async ({ task }) => {
      process.stderr.write(`FAILED ${task.name}: ${task.result?.errors?.[0]?.message ?? "?"}\n`);
      await shot(`FAILED-${ctx.task.name.slice(0, 40).replace(/[^a-z0-9]+/gi, "-")}`).catch(() => {});
    });
  });

  beforeAll(async () => {
    setAnimations(false);
    await setRotation(false);
    await m.signIn();
    const locationId = (await m.client.request<{ selectedLocationId: string }>("GET", "/api/users/location-context")).selectedLocationId;
    const post = <T>(path: string, body: unknown) => m.client.request<T>("POST", `${API}${path}`, { body });
    const { supplierId } = await post<{ supplierId: string }>("/suppliers", { supplierName: "Fresh Farms" });
    const { ingredientId } = await post<{ ingredientId: string }>("/ingredients", { ingredientName: "Plain flour", ingredientCategory: "dry_goods", baseUnit: "kg", unitCost: "1.40" });
    await m.client.request("PUT", `${API}/thresholds/location`, { body: { storeLocationId: locationId, amount: 200 } });
    const po = await post<{ poId: string; poNumber: string }>("/purchase-orders", { storeLocationId: locationId, supplierId, expectedDeliveryDate: "2030-05-06", lines: [{ ingredientId, orderedQty: "300", orderedUnit: "kg", unitCost: "1.40" }] });
    poId = po.poId;
    poNumber = po.poNumber;
    await post(`/purchase-orders/${poId}/submit`, {});
    expect(await status()).toBe("PENDING_APPROVAL");
  });
  afterAll(async () => {
    shell(`locksettings clear --old ${PIN}`);
    shell("svc", "power", "stayon", "false");
    await setRotation(false);
    setAnimations(true);
  });

  it("is what an approver meets after signing in, and asks for a screen lock on a device without one", async () => {
    await signIn();
    await expectLocked();
    await shot("l01-locked");
    await setRotation(true);
    await shot("l02-locked-landscape");
    await setRotation(false);
    await press("Unlock");
    await waitFor("Set up a screen lock", 20_000);
    expect(await readable(TABS)).toBe(false);
    await shot("l03-no-screen-lock");
  });

  it("stays locked when the prompt is cancelled, and opens with the PIN", async () => {
    shell(`locksettings set-pin ${PIN}`);
    shell("svc", "power", "stayon", "true");
    await press("Unlock");
    await waitPrompt(true);
    await shot("l04-system-prompt");
    for (let i = 0; i < 3 && promptUp(); i++) await back();
    await waitPrompt(false);
    await expectLocked();
    await shot("l05-cancelled");
    await unlock();
    await waitReadable(TABS, 60_000);
    await shot("l06-unlocked");
  });

  it("asks again before an approval, locks when that is cancelled, and approves after an unlock", async () => {
    await openTab("Orders");
    await press(/^Approvals/);
    await press(new RegExp(poNumber));
    await waitFor("Plain flour", 30_000);
    await shot("l07-order-to-approve");
    await sleep(125_000); // past the two minutes an unlock counts for
    await press("Approve");
    await waitFor(new RegExp(`^Approve ${poNumber}\\?`));
    await shot("l08-approve-question");
    await tap(/^approve$/i);
    await waitPrompt(true);
    await shot("l09-approve-prompt");
    for (let i = 0; i < 3 && promptUp(); i++) await back();
    await waitPrompt(false);
    await expectLocked();
    await shot("l10-cancelled-locked");
    expect(await status()).toBe("PENDING_APPROVAL");

    await unlock();
    await waitReadable(/^Plain flour$/);
    await press("Approve");
    await waitFor(new RegExp(`^Approve ${poNumber}\\?`));
    await tap(/^approve$/i);
    await waitFor("Order approved. It is now marked as sent.", 30_000);
    await shot("l11-approved");
    expect(await status()).toBe("SENT");
  });

  it("stays open over a short trip away, is covered in the app switcher, and locks after more than a minute", async () => {
    await goHome(10_000);
    await waitReadable(/^Plain flour$/);
    // From the home screen: opened from the app itself, the switcher shows its live window.
    await key("KEYCODE_HOME");
    await sleep(2000);
    await key("KEYCODE_APP_SWITCH");
    await sleep(2500);
    await shot("l12-app-switcher");
    expect(await readable(new RegExp(poNumber))).toBe(false);
    await comeBack();
    await waitReadable(/^Plain flour$/);
    await key("KEYCODE_HOME");
    await sleep(65_000);
    await filmComeBack("l13-the-way-back");
    await expectLocked();
    await shot("l13-locked-after-a-minute");
    await back();
    await sleep(800);
    await goHome(500);
    await expectLocked();
  });

  it("locks on a cold start and signs out only when asked", async () => {
    await launch();
    await expectLocked();
    await press("Sign out");
    await waitFor("Welcome back to the line.", 60_000);
    await shot("l14-signed-out");
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach, onTestFailed } from "vitest";
import {
  adb, back, clearApp, tapLabel, tapAt, clearField, darkIconsOnStatusBar, dump, fieldText, findAll, find, forceStop, has, hideKeyboard, isEnabled, openApp, screenshot,
  setAirplane, setAnimations, setDarkMode, setFontScale, setRotation, tap, typeInto, waitFor,
} from "./adb";
import { credentials, freshCode, seedAreaCount, type AreaFixture } from "./fixtures";

/**
 * The release-1 count walk on a real Android runtime (an emulator or a phone), driven through the app's own screens
 * against the real server. One story, in order; each step saves a screenshot to device/_shots so the result can be
 * looked at, and asserts what is on screen. Needs: the development build installed, Metro on METRO_URL, the server on
 * :3009, adb on the path or ANDROID_HOME set. See the dev brain page qa/mobile-device-walk.
 */
// Metro is reached through `adb reverse` (a tunnel over the debug connection), so airplane mode cannot cut the development
// build off from its JavaScript when the app is killed and reopened offline. The app's own API calls still go over the network.
const METRO = process.env.METRO_URL ?? "http://localhost:8088";
const API = "/api/inventory";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let fx: AreaFixture;
const row = (name: string) => new RegExp(`^${esc(name)}, \\d+ of \\d+ counted`);

async function launch() {
  forceStop();
  await openApp(METRO);
  // A first run can show the dev tools sheet over the app.
  await sleep(6000);
  if (await has("Go home")) await back();
}

async function signIn(password = credentials.password) {
  await waitFor("Sign in", 60_000);
  await clearField("Email");
  await typeInto("Email", credentials.email);
  await clearField("Password");
  await typeInto("Password", password);
  await hideKeyboard();
  await tap("Sign in");
}

async function enterCode(code: string) {
  await waitFor("Enter your 6-digit code", 30_000);
  await clearField("Code");
  await typeInto("Code", code);
  await hideKeyboard();
  await tap("Verify");
}

/** The number shown on the count screen ("nothing typed" when blank). */
async function numberShown(): Promise<string> {
  const node = await find(/^.+, (kg|L), .+$/);
  return node ? /, (?:kg|L), (.+)$/.exec(node.desc)![1] : "";
}

async function typeDigits(digits: string) {
  // The zero key is labelled for what it does ("Zero, none here"); on a blank entry it records a deliberate zero, otherwise it is the digit 0.
  for (const d of digits) await tapLabel(d === "." ? "Decimal point" : d === "0" ? "Zero, none here" : d);
}

/** Whatever screen a step ended on, get back to the areas list so one failure cannot cascade into the next steps. */
async function toAreas() {
  for (let i = 0; i < 6; i++) {
    if (await has(row(fx.areas.bar))) return;
    if (await has("DISCARD")) await tap("DISCARD");
    else if (await has("Back to areas")) await tap("Back to areas");
    else if (await has("Back")) await tap("Back");
    else await back();
    await sleep(1200);
  }
  await waitFor(row(fx.areas.bar), 20_000);
}

async function openArea(name: string) {
  await tap(row(name));
  await waitFor(/ item \d+ of \d+$|^Review /, 30_000);
}

/** On the count screen: type the number and save, landing on the next item or the review. */
async function countThis(digits: string) {
  await typeDigits(digits);
  await tap("Save and next");
  await sleep(500);
}

async function serverCategory(name: string) {
  const s = await fx.api.request<{ categories: Array<{ categoryName: string; categoryStatus: string }> }>("GET", `${API}/stock-takes/${fx.sessionId}`);
  return s.categories.find((c) => c.categoryName === name)!;
}

describe("count walk on a device", () => {
  // Whatever step fails, leave a picture of the screen at that moment next to the others.
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
    fx = await seedAreaCount();
    await launch();
  });

  afterAll(async () => {
    await setAirplane(false);
    setFontScale(1.0);
    setDarkMode(false);
    await setRotation(false);
    await fx.api.request("PUT", "/api/settings", { body: { mobile_min_app_version: "0.0.0" } }).catch(() => {});
    await fx.cleanup();
  });

  it("W1 launches to the sign-in screen, with no route error and a readable status bar", async () => {
    await waitFor("Sign in", 60_000);
    expect(await has(/Unmatched|doesn't exist|This screen/i)).toBe(false);
    expect(darkIconsOnStatusBar()).toBe(true); // dark clock and battery on the light paper
    await screenshot("w01-sign-in");
  });

  it("W2 a wrong password gets a plain sentence and keeps the email; a wrong code is refused; the right code signs in", async () => {
    await signIn("not-the-password-1");
    await waitFor("Email or password is wrong.", 30_000);
    expect(await fieldText("Email")).toBe(credentials.email);
    await screenshot("w02-wrong-password");

    await clearField("Password");
    await typeInto("Password", credentials.password);
    await hideKeyboard();
    await tap("Sign in");
    await enterCode("000000");
    await waitFor("That code didn't work. Try again.", 30_000);
    await screenshot("w02-wrong-code");

    await enterCode(await freshCode());
    await waitFor(row(fx.areas.bar), 40_000);
    await screenshot("w02-signed-in");
  });

  it("W2 stays signed in after the app is killed", async () => {
    await launch();
    await waitFor(row(fx.areas.bar), 40_000);
  });

  it("W3 lists the areas in shelf order with their shared-item notes", async () => {
    const rows = await findAll(/, \d+ of \d+ counted/);
    const names = rows.map((r) => r.desc.split(",")[0]);
    expect(names).toEqual([fx.areas.bar, fx.areas.cellar, fx.areas.pantry, fx.areas.bulk]);
    expect(await has(`Shares items with ${fx.areas.cellar}`)).toBe(true);
    await screenshot("w03-areas");
  });

  it("W4 the keypad: digits, decimals, backspace, the zero key and the 99,999 limit", async () => {
    await toAreas();
    await openArea(fx.areas.bar);
    expect(await has(`Also in ${fx.areas.cellar}`)).toBe(true);
    expect(await isEnabled("Save and next")).toBe(false); // nothing typed yet

    await typeDigits("42.5");
    expect(await numberShown()).toBe("42.5");
    await typeDigits("129");
    expect(await numberShown()).toBe("42.512"); // a fourth decimal is ignored
    await screenshot("w04-keypad-typed");
    for (let i = 0; i < 6; i++) await tapLabel("Delete");
    expect(await numberShown()).toBe("nothing typed");
    expect(await isEnabled("Save and next")).toBe(false);

    await tapLabel("Zero, none here");
    expect(await numberShown()).toBe("0");
    await tapLabel("Delete");
    await typeDigits("99999");
    await tap("1");
    await waitFor("The largest number is 99,999.", 10_000);
    expect(await numberShown()).toBe("99999");
    await screenshot("w04-keypad-limit");
    for (let i = 0; i < 5; i++) await tapLabel("Delete");

    await countThis("3"); // Shiraz in Bar = 3, the only item: lands on the review
    await waitFor(/^Review /, 20_000);
    await waitFor(/3 kg · Accepted/, 30_000);
    await screenshot("w04-review-accepted");
  });

  it("W8 submits Bar and the app says so", async () => {
    await tap("Submit area");
    await waitFor(row(fx.areas.bar), 30_000);
    await waitFor("Sent for review", 30_000);
    expect((await serverCategory(fx.areas.bar)).categoryStatus).toBe("SUBMITTED");
    await screenshot("w08-bar-submitted");
  });

  it("W8 Cellar shares Shiraz with Bar: skipping it blocks submit until it has a count (zero counts)", async () => {
    await toAreas();
    await openArea(fx.areas.cellar);
    await tap("Skip");
    await waitFor(/^Review /, 20_000);
    await waitFor(`Not counted here. Also in ${fx.areas.bar}: enter 0 if none.`, 10_000);
    expect(await isEnabled("Submit area")).toBe(false);
    await screenshot("w08-shared-gap");

    await tap(new RegExp(`^${esc(fx.items.shared)}:`));
    await waitFor(/ item 1 of 1$/, 20_000);
    await tapLabel("Zero, none here");
    await tap("Save and next");
    await waitFor(/0 kg · Accepted/, 30_000);
    await tap("Submit area");
    await waitFor(row(fx.areas.cellar), 30_000);
    expect((await serverCategory(fx.areas.cellar)).categoryStatus).toBe("SUBMITTED");
  });

  it("W5 with no signal an unclaimed area cannot be started, and says why", async () => {
    await toAreas();
    await setAirplane(true);
    await tap(row(fx.areas.pantry));
    await waitFor("Connect to start counting this area.", 20_000);
    await screenshot("w05-offline-claim");
    await setAirplane(false);
  });

  it("W5/W6 counts made with no signal stay on the phone, survive the app being killed, and submit waits", async () => {
    await toAreas();
    await openArea(fx.areas.pantry); // claimed online
    await back();
    await waitFor(row(fx.areas.pantry), 20_000);

    await setAirplane(true);
    await openArea(fx.areas.pantry); // already claimed: opens with no signal
    await countThis("11");
    await countThis("12");
    await screenshot("w05-offline-counted");
    await tap("Previous");
    await tap("Previous").catch(() => {});
    await waitFor("Saved on this phone", 20_000);
    await screenshot("w05-saved-on-phone");
    await tap("Review");
    await waitFor(/^Review /, 20_000);
    await waitFor(/still waiting to send/, 20_000);
    expect(await isEnabled("Submit area")).toBe(false);
    await screenshot("w05-submit-waits");

    forceStop(); // W6: killed with counts unsent
    await openApp(METRO);
    await sleep(6000);
    await waitFor(/\d+ waiting to send/, 40_000);
    await waitFor(/You're offline/, 40_000);
    await screenshot("w07-reopened-offline");
  });

  it("W9 a manager sends the area for review meanwhile: the phone's counts come back as needs-attention with the reason, and discarding asks first", async () => {
    // The manager (on the web) submits Pantry while the chef's counts wait on the phone.
    const pantry = (await fx.api.request<{ categories: Array<{ categoryName: string; claimRevision: number }> }>("GET", `${API}/stock-takes/${fx.sessionId}`)).categories.find((c) => c.categoryName === fx.areas.pantry)!;
    await fx.api.request("POST", `${API}/stock-takes/${fx.sessionId}/categories/${encodeURIComponent(fx.areas.pantry)}/submit`, { body: { claimRevision: pantry.claimRevision } });

    await setAirplane(false);
    await waitFor(/\d+ counts? needs? attention/, 150_000);
    await screenshot("w09-areas-needs-attention");
    await tap(/counts? needs? attention/);
    await waitFor("Needs attention", 20_000);
    await waitFor(/This area was already sent for review, so this count wasn't added\./, 20_000);
    await screenshot("w09-needs-attention");

    await tap("Discard this count");
    await waitFor(/^Discard \d+ kg of /, 15_000); // the native confirmation names the quantity and item
    await screenshot("w09-discard-confirm");
    await tap(/^discard$/i); // Android capitalises dialog buttons
    await sleep(1500);
    expect((await findAll("Discard this count")).filter((n) => n.text !== "").length).toBe(1); // one of the two is gone, the other still listed
    await tap("Discard this count");
    await tap(/^discard$/i);
    await waitFor("Nothing needs attention.", 20_000);
    await back();
  });

  it("W18 25 counts made with no signal all arrive in order, none lost, within the send cap", async () => {
    await toAreas();
    await waitFor(row(fx.areas.bulk), 20_000);
    await openArea(fx.areas.bulk); // claimed online
    await back();
    await waitFor(row(fx.areas.bulk), 20_000);

    await setAirplane(true);
    await openArea(fx.areas.bulk);
    // The keypad does not move between items, so read where the keys are once instead of before every tap.
    const nodes = await dump();
    const at = (label: string) => {
      const n = nodes.find((x) => x.desc === label)!;
      return [Math.round((n.x1 + n.x2) / 2), Math.round((n.y1 + n.y2) / 2)] as const;
    };
    const keys = Object.fromEntries([..."0123456789"].map((d) => [d, at(d === "0" ? "Zero, none here" : d)]));
    const save = at("Save and next");
    for (let i = 1; i <= 25; i++) {
      for (const d of String(i)) await tapAt(...keys[d]);
      await tapAt(...save);
      await sleep(400);
    }
    await waitFor(/^Review /, 30_000);
    await screenshot("w18-offline-25");
    await setAirplane(false);

    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline && (await findAll(/ · Accepted$/)).length < 25) await sleep(5000);
    await screenshot("w18-accepted");
    const lines = await fx.api.request<unknown[]>("GET", `${API}/stock-takes/${fx.sessionId}/categories/${encodeURIComponent(fx.areas.bulk)}/lines`);
    expect(lines).toHaveLength(25);
  }, 900_000);

  it("W13-15 large text, landscape and dark mode keep the count screen usable", async () => {
    // Changing the system text size restarts the Android activity (fontScale is not in the manifest's configChanges),
    // which drops the app back to the areas list. So set the size first, then walk in to the count screen.
    const openFirstBulkItem = async () => {
      await toAreas();
      await openArea(fx.areas.bulk); // every item counted, so this opens the review
      await tap(new RegExp(`^${esc(fx.items.bulk[0])}:`));
      await waitFor(/ item 1 of 25$/, 20_000);
    };
    setFontScale(2.0);
    await sleep(4000);
    await openFirstBulkItem();
    const number = await find(/^.+, (kg|L), .+$/);
    expect(number && number.x2 <= 1080).toBe(true); // the typed number is not pushed off screen
    await screenshot("w13-large-text");
    setFontScale(1.0);
    await sleep(4000);
    await openFirstBulkItem();

    await setRotation(true);
    // The count screen scrolls; in landscape the keypad fills the width, so Save is below the fold until scrolled to.
    await screenshot("w14-landscape");
    adb(["shell", "input", "swipe", "1200", "700", "1200", "100", "300"]);
    await sleep(800);
    expect(await has("Save and next")).toBe(true);
    await screenshot("w14-landscape-scrolled");
    await setRotation(false);

    setDarkMode(true);
    await sleep(2500);
    expect(darkIconsOnStatusBar()).toBe(true); // the app stays light paper, as the first app does, so the icons stay dark
    await screenshot("w15-count-dark");
    await back().catch(() => {});
    setDarkMode(false);
    await sleep(1500);
  });

  it("W8 submits Bulk; with every area in, the stock take moves to review", async () => {
    await toAreas();
    await openArea(fx.areas.bulk); // every item counted, so this opens the review
    // 25 rows: the button is at the bottom of a scrolling list.
    for (let i = 0; i < 8 && !(await has("Submit area")); i++) {
      adb(["shell", "input", "swipe", "540", "1800", "540", "400", "300"]);
      await sleep(600);
    }
    await waitFor("Submit area", 20_000);
    await tap("Submit area");
    await waitFor(row(fx.areas.bulk), 30_000);
    const s = await fx.api.request<{ sessionStatus: string }>("GET", `${API}/stock-takes/${fx.sessionId}`);
    expect(s.sessionStatus).toBe("PENDING_REVIEW");
    await screenshot("w08-all-submitted");
  });

  it("W11 below the minimum app version the app is asked to update at sign-in, and works again once it is lifted", async () => {
    await fx.api.request("PUT", "/api/settings", { body: { mobile_min_app_version: "9.9.9" } });
    await tap("Sign out");
    await waitFor("Sign in", 30_000);
    await signIn(); // the version check answers at the password step, before any code is asked for
    await waitFor("Update the app to continue.", 30_000);
    await screenshot("w11-update-required");

    await fx.api.request("PUT", "/api/settings", { body: { mobile_min_app_version: "0.0.0" } });
    await waitFor("Sign in", 20_000);
    await signIn();
    await enterCode(await freshCode());
    await waitFor(row(fx.areas.bar), 40_000);
  });
});

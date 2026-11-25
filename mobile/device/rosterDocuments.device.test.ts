import { describe, it, beforeAll, afterAll, beforeEach, onTestFailed } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adb, back, clearApp, clearField, dismissSavePassword, dump, findAll, forceStop, has, hideKeyboard, openApp, openTab, setAirplane, setAnimations, setRotation, swipe, tap, tapAt, typeInto, waitFor as waitForExact } from "./adb";
import { createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createSession } from "../src/auth/session";
import { credentials, freshCode, manager } from "./fixtures";

/**
 * The roster and documents walk: my shifts, a shift, swaps, availability, my documents and adding one (the system's camera question and photo
 * picker included), photographed for a person to look at. The venue is in Perth, so a time that reads on the phone's own clock shows at once.
 * Run it through `SCREENS_FILE=device/rosterDocuments.device.test.ts bash device/screens.sh <out-dir>`, which makes the database, the
 * server (with the fake file store) and Metro; skipped without it. It needs a device that may be given a photo: the emulator.
 */
const METRO = process.env.METRO_URL ?? "http://127.0.0.1:8088";
const FORM = process.env.SCREENS_FORM ?? "phone";
const OUT = resolve(process.env.SCREENS_OUT ?? "device/_shots/roster", FORM);
const HOUR = 3_600_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const adbPath = process.env.ADB ?? `${process.env.ANDROID_HOME ?? `${process.env.HOME}/android-sdk`}/platform-tools/adb`;

const m = manager();
let locationId = "";
let organisationId = 0;
let me = 0;

/** The display as the app has it: the override when the walk turned it on its side (adb.ts's `screenSize` reads the device's own). */
const screenSize = () => /(\d+)x(\d+)/.exec(adb(["shell", "wm", "size"]).trim().split("\n").pop()!)!.slice(1).map(Number) as [number, number];

async function shot(name: string) {
  await sleep(900);
  for (let i = 0; i < 3 && (await dismissSavePassword()); i++);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, `${name}.png`), execFileSync(adbPath, ["exec-out", "screencap", "-p"], { maxBuffer: 1 << 26 }));
}

/** The throwaway database of this walk only: a venue's zone, a holiday question, a manager's decision and a document's age cannot all be made through the API. */
function sql(statement: string) {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("postgresql://ci@127.0.0.1:55432/")) throw new Error("the roster walk changes rows only in the local throwaway database");
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-qc", statement]);
}

/** Copper capitals labels reach the screen dump in capitals, so plain words are matched whatever their case. */
const waitFor = (t: string | RegExp, ms?: number) => waitForExact(typeof t === "string" ? new RegExp(`^${t.replace(/[.?]/g, "\\$&")}$`, "i") : t, ms);
const scroll = async (up = false) => {
  const [w, h] = screenSize();
  await swipe(Math.round(w / 2), Math.round(h * (up ? 0.35 : 0.65)), Math.round(w / 2), Math.round(h * (up ? 0.65 : 0.35)), 400);
};
/** Tap a button by its label, scrolling to it. */
async function press(label: string | RegExp) {
  for (let i = 0; i < 9; i++) {
    const [, h] = screenSize();
    const button = (await dump()).find((n) => n.clickable && (typeof label === "string" ? n.desc === label || n.text === label : label.test(n.desc)) && n.y2 < h * 0.93);
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
  forceStop();
  clearApp();
  await openApp(METRO);
  await sleep(6000);
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
    const b = (await findAll("Sign in")).at(-1)!;
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
/** The module's first screen, whatever was left open in it and however far down: `button` is one only that screen has. Back is pressed only where it is not at the top. */
async function home(tab: string, button: string) {
  await openTab(tab);
  const there = async () => (await dump()).some((n) => n.clickable && n.desc.startsWith(button));
  for (let i = 0; i < 6 && !(await there()); i++) {
    for (let k = 0; k < 3 && !(await there()); k++) await scroll(true);
    if (await there()) break;
    await back();
    await sleep(800);
  }
  if (!(await there())) throw new Error(`not on the first screen of ${tab}`);
}

/** A colleague who works at the same place, signed in as the app does. */
async function colleague() {
  let tokens: Tokens | null = null;
  const tokenStore = { load: async () => tokens, save: async (t: Tokens) => void (tokens = t), clear: async () => void (tokens = null) };
  const client = createApiClient({ baseUrl: process.env.E2E_API_URL!, appVersion: "0.1.0-device", tokenStore });
  const authApi = createAuthApi(client, tokenStore);
  const session = createSession({ api: authApi, hasTokens: async () => tokens !== null, snapshots: { load: async () => null, save: async () => {} } });
  const email = `walk-${Date.now().toString(36)}@culinaire.test`;
  const org = (await m.client.request<{ organisation: { joinKey: string } }>("GET", "/api/organisations/mine")).organisation;
  const { storeKey } = (await m.client.request<{ storeLocation: { storeKey: string } }>("GET", `/api/store-locations/${locationId}`)).storeLocation;
  await authApi.register("Samira Okafor", email, "Walk-Roster-Pass-1!");
  await session.signIn(email, "Walk-Roster-Pass-1!");
  await session.joinOrganisation(org.joinKey);
  await session.joinLocation(storeKey);
  const state = session.getSnapshot().state;
  if (state.phase !== "ready") throw new Error("the colleague did not sign in");
  return { client, userId: state.user.userId };
}

/** `day` days after this week's Monday, `hour` o'clock in Perth (UTC+8, no summer time). */
function perth(day: number, hour: number): Date {
  const now = new Date(Date.now() + 8 * HOUR);
  const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  return new Date(monday + (day * 24 + hour - 8) * HOUR);
}
const roles: Record<string, string> = {};
async function shift(role: string, day: number, from: number, hours: number, userId: number) {
  roles[role] ??= (await m.client.request<{ rosterRoleId: string }>("POST", "/api/roster/roles", { body: { roleName: role } })).rosterRoleId;
  const start = perth(day, from);
  const { shiftId } = await m.client.request<{ shiftId: string }>("POST", "/api/roster/shifts", { body: { storeLocationId: locationId, rosterRoleId: roles[role], startDatetime: start.toISOString(), endDatetime: new Date(start.getTime() + hours * HOUR).toISOString() } });
  const { assignmentId } = await m.client.request<{ assignmentId: string }>("POST", `/api/roster/shifts/${shiftId}/assignments`, { body: { userId } });
  return { shiftId, assignmentId };
}
const document = (fields: object) =>
  m.client.request<{ complianceDocumentId: string }>("POST", "/api/compliance/documents", {
    body: { engagementType: "employee", storagePublicId: `culinaire/compliance/org-${organisationId}/user-${me}/walk${Math.random().toString(36).slice(2)}`, storageFormat: "jpg", ...fields },
  });

/** The newest photo in the system picker. */
async function pickFirst() {
  const picture = (await dump()).find((n) => /^Photo taken|^Photo,|certificate/i.test(n.desc));
  if (!picture) throw new Error("no photo in the system picker");
  await tapAt(Math.round((picture.x1 + picture.x2) / 2), Math.round((picture.y1 + picture.y2) / 2));
}

describe.skipIf(!process.env.SCREENS_OUT)(`roster and documents on ${FORM}`, { timeout: 600_000 }, () => {
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
    const ctx = await m.client.request<{ selectedLocationId: string; organisationId: number }>("GET", "/api/users/location-context");
    locationId = ctx.selectedLocationId;
    organisationId = ctx.organisationId;
    me = (await m.client.request<{ user: { userId: number } }>("GET", "/api/auth/me")).user.userId;
    sql(`update store_location set iana_timezone = 'Australia/Perth' where store_location_id = '${locationId}'`);
    await signIn();
    // Signed in upright: on its side the keyboard covers the password field.
    if (FORM === "tablet-landscape") {
      const [w, h] = /Physical size: (\d+)x(\d+)/.exec(adb(["shell", "wm", "size"]))!.slice(1);
      adb(["shell", "wm", "size", `${h}x${w}`]);
      await sleep(4000);
    }
  }, 600_000);
  afterAll(async () => {
    await setAirplane(false);
    adb(["shell", "wm", "size", "reset"]);
    setAnimations(true);
  });

  it("nothing yet: no shifts, no swaps, no availability, no documents", async () => {
    await home("More", "Documents");
    await shot("r00-more");
    await home("Roster", "My availability");
    await waitFor("No shifts yet", 30_000);
    await shot("r01-roster-empty");
    await press("Open swaps");
    await waitFor("No open swaps");
    await shot("r02-swaps-empty");
    await press("Back");
    await press("My availability");
    await waitFor("No availability yet");
    await shot("r03-availability-empty");
    await home("Documents", "Add a certificate");
    await waitFor("Add your first certificate", 30_000);
    await shot("d01-documents-empty");
  });

  it("shifts: the two weeks, one to answer, a public holiday, a swap", async () => {
    const sam = await colleague();
    // Today in Perth is at least a Monday, so tomorrow on: the week's later days and all of next week are ahead.
    const pending = await shift("Chef de partie", 7, 6, 8, me);
    const late = await shift("Sous chef", 8, 18, 8, me);
    const holiday = await shift("Chef de partie", 10, 9, 8.5, me);
    await shift("Pastry chef and morning bread section lead", 0, 5, 8, me);
    const offered = await shift("Bar", 9, 16, 7, sam.userId);
    await m.client.request("POST", `/api/roster/assignments/${late.assignmentId}/respond`, { body: { response: "Confirmed" } });
    await sam.client.request("POST", `/api/roster/assignments/${offered.assignmentId}/respond`, { body: { response: "Confirmed" } });
    await m.client.request("POST", "/api/roster/publish", { body: { storeLocationId: locationId, from: perth(0, 8).toISOString().slice(0, 10), to: perth(14, 8).toISOString().slice(0, 10) } });
    // A draft, which staff never see, with a consent question on it.
    const draft = await shift("Secret draft role", 11, 9, 8, me);
    sql(`update shift_assignment set public_holiday_consent = 'Requested' where assignment_id = '${draft.assignmentId}'`);
    sql(`update shift set is_public_holiday = true where shift_id = '${holiday.shiftId}'; update shift_assignment set public_holiday_consent = 'Requested', status = 'Confirmed' where assignment_id = '${holiday.assignmentId}'`);
    await sam.client.request("POST", "/api/workforce/swaps", { body: { assignmentId: offered.assignmentId } });

    await home("Roster", "My availability");
    await waitFor(/needs? your answer$/, 30_000);
    if (await has(/secret draft/i)) throw new Error("a draft shift is on the list");
    await shot("r04-roster");
    await scroll();
    await shot("r05-roster-foot");
    await scroll(true);
    await press(/, 6:00 am–2:00 pm, Chef de partie/);
    await waitFor("Confirm shift");
    await shot("r06-shift-pending");
    await press("Decline");
    await waitFor("Decline this shift?");
    await shot("r07-shift-decline-asks");
    await tap(/^Not now$/i);
    await press("Confirm shift");
    await waitFor("You're confirmed for this shift.", 30_000);
    await shot("r08-shift-confirmed");
    await press("Offer to swap");
    await waitFor("Offer this shift for swap?");
    await tap(/^Offer it$/i);
    await waitFor("Take the offer back", 30_000);
    await shot("r09-shift-offered");
    await press("Take the offer back");
    await waitFor(/Your offer is taken back/, 30_000);
    await press("Back");
    await press(/Public holiday/);
    await waitFor("Would you work this public holiday?");
    await shot("r10-shift-public-holiday");
    await press("Back");
    void pending;
  });

  it("swaps: a colleague's shift, taken", async () => {
    await home("Roster", "My availability");
    await press(/^Open swaps/);
    await waitFor(/Offered by/, 30_000);
    await shot("r11-swaps");
    await press(/^Take /);
    await waitFor("Take this shift?");
    await shot("r12-swap-asks");
    await tap(/^Take it$/i);
    await waitFor("The shift is yours.", 30_000);
    await shot("r13-swap-taken");
  });

  it("availability: the form, an error, saved, changed", async () => {
    await home("Roster", "My availability");
    await press("My availability");
    await press("Add availability");
    await waitFor("First day");
    await shot("r14-availability-form");
    await type("Until", "0800");
    await press("Save");
    await waitFor(/must be after/);
    await shot("r15-availability-error");
    await type("Until", "1730");
    await type("Last day (optional)", "28022027");
    await shot("r16-availability-filled");
    await press("Save");
    await waitFor(/^Monday 09:00–17:30$/, 30_000);
    await press("Add availability");
    await waitFor("First day");
    await tap("Saturday");
    await press("Save");
    await waitFor(/^Saturday 09:00–17:00$/, 30_000);
    await shot("r17-availability");
    // No signal: the emulator does not always lose its way to the server in airplane mode, so this picture is taken only when it does.
    await setAirplane(true);
    await press("Back");
    if (await waitFor(/needs a connection/, 60_000).catch(() => null)) await shot("r18-roster-no-signal");
    await setAirplane(false);
  });

  it("documents: what needs me, what is with the manager, one of each", async () => {
    const rejected = await document({ documentType: "RSA", documentNumber: "VIC-20418", issueDate: "2023-03-14", expiryDate: "2028-03-14", issuingJurisdiction: "VIC" });
    const waiting = await document({ documentType: "Food Safety Supervisor", documentNumber: "FSS-88120", issueDate: "2025-06-02", expiryDate: "2030-06-02", issuingJurisdiction: "WA" });
    const verified = await document({ documentType: "Police Check", issueDate: "2026-01-20", issuingJurisdiction: "WA" });
    const expired = await document({ documentType: "First aid and mental health first aid", expiryDate: "2026-02-01" });
    sql(`update compliance_document set verification_status = 'Rejected', rejection_reason = 'The photo is cut off on the right, so the expiry date cannot be read.' where compliance_document_id = '${rejected.complianceDocumentId}';
      update compliance_document set uploaded_at = now() - interval '4 days' where compliance_document_id = '${waiting.complianceDocumentId}';
      update compliance_document set verification_status = 'Verified' where compliance_document_id in ('${verified.complianceDocumentId}', '${expired.complianceDocumentId}')`);
    await home("Documents", "Add a certificate");
    await waitFor("Needs you", 30_000);
    await shot("d02-documents");
    await scroll();
    await shot("d03-documents-foot");
    await scroll(true);
    await press(/^RSA, Not accepted/);
    await waitFor("What to fix");
    await shot("d04-document-rejected");
    await press("Correct the details");
    await waitFor("Send for review again");
    await shot("d05-document-correct");
    await type("Expires", "14032029");
    await press("Send for review again");
    await waitFor(/^With your manager/, 30_000); // the status, or the line under the details when the page is scrolled
    await shot("d06-document-sent-again");
    await press("Delete");
    await waitFor("Delete this RSA?");
    await shot("d07-document-delete-asks");
    await tap(/^Keep it$/i);
    await press("Back");
    await press(/^Food Safety Supervisor/);
    await press("Remind your manager");
    await waitFor("Reminder sent.", 30_000);
    await shot("d08-document-reminded");
    await press("Show the photo");
    await sleep(6000);
    await scroll();
    await shot("d09-document-photo");
  });

  it("add a certificate: the camera's question, no camera, a photo from the library, sent", async () => {
    // A photo for the picker, with a place in it, to check what leaves the phone.
    if (process.env.WALK_PHOTO) {
      adb(["push", process.env.WALK_PHOTO, "/sdcard/Pictures/certificate.jpg"]);
      adb(["shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", "file:///sdcard/Pictures/certificate.jpg"]);
    }
    await home("Documents", "Add a certificate");
    await press("Add a certificate");
    await waitFor("What is it?");
    await shot("d10-add");
    await tap("Food Handler");
    await press("Take a photo");
    await waitFor(/take pictures and record video|take pictures/i, 30_000);
    await shot("d11-add-camera-question");
    await tap(/^Don.t allow$/i);
    await waitFor(/The camera isn't allowed/, 30_000);
    await shot("d12-add-camera-refused");
    if (!process.env.WALK_PHOTO) return;
    await press("Choose a photo");
    await sleep(5000);
    await shot("d13-add-photo-picker");
    await pickFirst();
    await waitFor("✓ Photo added", 60_000);
    await shot("d14-add-photo-added");
    // Nothing of the photo is left as a file: the picker's folder is gone, and no file of the app names the camera that "took" it (WalkCam, in its EXIF).
    const app = (command: string) => adb(["shell", `run-as com.culinairekitchen.chef sh -c '${command}'`]).trim();
    if (app("ls cache/ImagePicker 2>/dev/null | wc -l") !== "0") throw new Error("the picker's copy of the photo is still on the phone");
    if (app("grep -rl WalkCam . 2>/dev/null | wc -l") !== "0") throw new Error("a file of the app still holds the photo's metadata");
    await type("Certificate number", "FH-55213");
    await type("Expires", "08072028");
    await scroll();
    await shot("d15-add-filled");
    await press("Send for review");
    await waitFor("Sent for review", 60_000);
    await shot("d16-add-sent");
    await press("Back to my documents");
    await waitFor(/^Food Handler/, 30_000);
    await shot("d17-documents-after");
  });

  it("profile picture: chosen, cropped and sent the same way", async (ctx) => {
    if (!process.env.WALK_PHOTO) return ctx.skip();
    await openTab("More");
    await press("Account"); // the last row, under the fold on its side
    await press("My details");
    await press("Choose photo");
    await sleep(5000);
    await pickFirst();
    await sleep(4000);
    await shot("p01-crop");
    await tap(/^(crop|done|save)$/i, 20_000);
    // The message is under the form.
    for (let i = 0; i < 12 && !(await has("Picture updated.")); i++) {
      await sleep(1500);
      await scroll();
    }
    await waitFor("Picture updated.", 5000);
    await shot("p02-picture-updated");
  });
});

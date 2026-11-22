/**
 * A small driver for a real Android phone or an emulator, built only on `adb` and `uiautomator` (already part of the
 * Android SDK, nothing extra to install). Find things on screen by their text or accessibility label, tap, type,
 * toggle airplane mode, kill the app and take screenshots. Used by the device tests in this folder.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sdk = process.env.ANDROID_HOME ?? `${process.env.HOME}/Android/Sdk`;
const ADB = process.env.ADB ?? `${sdk}/platform-tools/adb`;
/** Relative to where the tests run from (the mobile folder). */
export const SHOTS = resolve(process.cwd(), "device/_shots");
export const PACKAGE = "com.culinairekitchen.chef";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function adb(args: string[], input?: string): string {
  // The phone and emulator are shared by every worker; device/lease.sh takes the lock and sets this.
  if (process.env.CULINAIRE_DEVICE_LEASE !== "1") {
    throw new Error("refusing to drive a device without the lease: run check:device (pnpm --filter @culinaire/mobile run check:device)");
  }
  return execFileSync(ADB, args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
}
const shell = (...args: string[]) => adb(["shell", ...args]);

export interface UiNode {
  text: string;
  desc: string;
  cls: string;
  id: string;
  enabled: boolean;
  clickable: boolean;
  focused: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const unescapeXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");

/** Every node on screen. uiautomator sometimes cannot get a still frame while something animates, so it retries. */
export async function dump(): Promise<UiNode[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      shell("uiautomator", "dump", "/sdcard/window.xml");
      const xml = adb(["exec-out", "cat", "/sdcard/window.xml"]);
      const nodes: UiNode[] = [];
      for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
        const attrs: Record<string, string> = {};
        for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = unescapeXml(a[2]);
        const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs.bounds ?? "");
        if (!b) continue;
        nodes.push({
          text: attrs.text ?? "",
          desc: attrs["content-desc"] ?? "",
          cls: attrs.class ?? "",
          id: attrs["resource-id"] ?? "",
          enabled: attrs.enabled !== "false",
          clickable: attrs.clickable === "true",
          focused: attrs.focused === "true",
          x1: +b[1],
          y1: +b[2],
          x2: +b[3],
          y2: +b[4],
        });
      }
      return nodes;
    } catch (err) {
      lastError = err;
      await sleep(400);
    }
  }
  throw new Error(`could not read the screen: ${String(lastError)}`);
}

export type Matcher = string | RegExp;
const matches = (m: Matcher, s: string) => (typeof m === "string" ? s === m : m.test(s));
const nodeMatches = (n: UiNode, m: Matcher) => (n.text !== "" && matches(m, n.text)) || (n.desc !== "" && matches(m, n.desc));

export async function find(m: Matcher, pick: (nodes: UiNode[]) => UiNode | undefined = (n) => n[0]): Promise<UiNode | undefined> {
  return pick((await dump()).filter((n) => nodeMatches(n, m)));
}

/** Wait until something with this text or label is on screen. Returns it. */
export async function waitFor(m: Matcher, timeoutMs = 20_000): Promise<UiNode> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const node = await find(m);
    if (node) return node;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${String(m)}\nOn screen: ${(await texts()).join(" | ")}`);
    await sleep(500);
  }
}

export async function waitGone(m: Matcher, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (await find(m)) {
    if (Date.now() > deadline) throw new Error(`${String(m)} is still on screen`);
    await sleep(500);
  }
}

export async function has(m: Matcher): Promise<boolean> {
  return (await find(m)) !== undefined;
}

/** All the words on screen, for failure messages and loose assertions. */
export async function texts(): Promise<string[]> {
  return [...new Set((await dump()).flatMap((n) => [n.text, n.desc]).filter((t) => t !== ""))];
}

const center = (n: UiNode) => ({ x: Math.round((n.x1 + n.x2) / 2), y: Math.round((n.y1 + n.y2) / 2) });

export async function tapAt(x: number, y: number): Promise<void> {
  shell("input", "tap", String(x), String(y));
  await sleep(350);
}

/** Tap the thing with this text or label (waiting for it to appear). */
export async function tap(m: Matcher, timeoutMs = 20_000): Promise<void> {
  const node = await waitFor(m, timeoutMs);
  const { x, y } = center(node);
  await tapAt(x, y);
}

/** True when the control is on screen and not disabled. */
export async function isEnabled(m: Matcher): Promise<boolean> {
  const node = await find(m);
  return node !== undefined && node.enabled;
}

/** `adb shell input text` needs spaces and shell characters escaped. */
function escapeForInput(text: string): string {
  return text.replace(/([\\'"`&|;<>()$*?!{}[\]~#^ ])/g, (c) => (c === " " ? "%s" : `\\${c}`));
}

/** Tap a text field (an EditText with this label) and type into it. */
export async function typeInto(label: Matcher, text: string): Promise<void> {
  const field = await find(label, (nodes) => nodes.find((n) => n.cls.includes("EditText")));
  if (!field) throw new Error(`no text field labelled ${String(label)}\nOn screen: ${(await texts()).join(" | ")}`);
  const { x, y } = center(field);
  await tapAt(x, y);
  await sleep(500); // focus moves a beat after the tap when another field has the keyboard open
  shell("input", "text", escapeForInput(text));
  await sleep(1200); // the keyboard resizes the window; let the layout settle before the next field is looked up
}

export async function key(code: string): Promise<void> {
  shell("input", "keyevent", code);
  await sleep(300);
}
export const back = () => key("KEYCODE_BACK");
export const hideKeyboard = async () => {
  if (shell("dumpsys", "input_method").includes("mInputShown=true")) await back();
};

export async function swipe(x1: number, y1: number, x2: number, y2: number, ms = 300): Promise<void> {
  shell("input", "swipe", String(x1), String(y1), String(x2), String(y2), String(ms));
  await sleep(400);
}

export async function screenshot(name: string): Promise<string> {
  mkdirSync(SHOTS, { recursive: true });
  const file = resolve(SHOTS, `${name}.png`);
  const png = execFileSync(ADB, ["exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(file, png);
  return file;
}

/** Real airplane mode: the radios go off, exactly as when a chef walks into a cold room. */
export async function setAirplane(on: boolean): Promise<void> {
  shell("cmd", "connectivity", "airplane-mode", on ? "enable" : "disable");
  await sleep(on ? 1500 : 3000);
}

export const forceStop = () => void shell("am", "force-stop", PACKAGE);

/** Open the development build straight onto Metro (no launcher screen, no first-run sheet). */
export async function openApp(metroUrl: string): Promise<void> {
  const link = `exp+culinaire-kitchen://expo-development-client/?url=${encodeURIComponent(metroUrl)}&disableOnboarding=1`;
  shell("am", "start", "-a", "android.intent.action.VIEW", "-d", `'${link}'`);
  await sleep(1500);
}

/** Phone settings, changed from outside the app. */
export const setFontScale = (scale: number) => void shell("settings", "put", "system", "font_scale", String(scale));
export const setDarkMode = (on: boolean) => void shell("cmd", "uimode", "night", on ? "yes" : "no");
export const setAnimations = (on: boolean) => {
  const v = on ? "1.0" : "0.0";
  shell("settings", "put", "global", "animator_duration_scale", v);
  shell("settings", "put", "global", "transition_animation_scale", v);
  shell("settings", "put", "global", "window_animation_scale", v);
};
export const screenSize = () => /(\d+)x(\d+)/.exec(shell("wm", "size"))!.slice(1).map(Number) as [number, number];

/** Wipe the app's storage (secure store, SQLite, caches): a fresh install without reinstalling. */
export const clearApp = () => void shell("pm", "clear", PACKAGE);

/** True when Android is drawing dark status bar icons (the app asked for them, as it should on light paper). */
export const darkIconsOnStatusBar = () => shell("dumpsys", "window").includes("LIGHT_STATUS_BARS");

export const setRotation = async (landscape: boolean) => {
  shell("settings", "put", "system", "accelerometer_rotation", "0");
  shell("settings", "put", "system", "user_rotation", landscape ? "1" : "0");
  await sleep(2500);
};

/** Delete everything typed in a text field. */
export async function clearField(label: Matcher): Promise<void> {
  const field = await find(label, (nodes) => nodes.find((n) => n.cls.includes("EditText")));
  if (!field) throw new Error(`no text field labelled ${String(label)}`);
  const { x, y } = center(field);
  await tapAt(x, y);
  shell("input", "keyevent", "KEYCODE_MOVE_END", ...Array(40).fill("KEYCODE_DEL"));
  await sleep(300);
}

/** The text of a field (what the person sees typed in it). */
export async function fieldText(label: Matcher): Promise<string> {
  const field = await find(label, (nodes) => nodes.find((n) => n.cls.includes("EditText")));
  return field?.text ?? "";
}

/** Every node whose text or label matches, top to bottom. */
export async function findAll(m: Matcher): Promise<UiNode[]> {
  return (await dump()).filter((n) => nodeMatches(n, m)).sort((a, b) => a.y1 - b.y1);
}

/** Tap a control by its accessibility label only. The big number on screen is also plain text, so "9" by text can hit it. */
export async function tapLabel(label: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const node = (await dump()).find((n) => n.desc === label);
    if (node) return tapAt(Math.round((node.x1 + node.x2) / 2), Math.round((node.y1 + node.y2) / 2));
    if (Date.now() > deadline) throw new Error(`no control labelled "${label}"\nOn screen: ${(await texts()).join(" | ")}`);
    await sleep(500);
  }
}

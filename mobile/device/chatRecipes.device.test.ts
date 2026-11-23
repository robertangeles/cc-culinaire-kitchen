import { describe, it, expect, beforeAll, afterAll, beforeEach, onTestFailed } from "vitest";
import { adb, back, clearApp, clearField, findAll, has, hideKeyboard, openApp, forceStop, screenshot, setAnimations, setDarkMode, setFontScale, setRotation, swipe, screenSize, tap, tapAt, texts, typeInto, waitFor } from "./adb";
import { credentials, freshCode, manager } from "./fixtures";

/**
 * Ask Antoine and the recipes screens on a real Android phone, against a local server whose model is `device/fakeModel.mjs`
 * (no paid model calls): a streamed answer that is seen growing on screen, Stop, a failed answer with Try again, My Recipes,
 * the Recipe Lab's wait and Stop, a made recipe, a refinement and the public switch. Then the same screens at iPad width: the
 * phone's density is lowered so the screen is 820 dp wide (an iPad in portrait), and put back after. Screenshots go to device/_shots.
 * Needs: the development build installed, Metro on METRO_URL, the server with the fake model on E2E_API_URL, `adb reverse` for
 * both, and the E2E user.
 */
const METRO = process.env.METRO_URL ?? "http://localhost:8088";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const m = manager();
/** What the E2E user already had, so the walk deletes only what it made. */
let recipesBefore: string[] = [];
let conversationsBefore: string[] = [];
const myRecipeIds = async () => (await m.client.request<{ recipes: { recipeId: string }[] }>("GET", "/api/recipes/my?limit=100")).recipes.map((r) => r.recipeId);
const conversationIds = async () => (await m.client.request<{ conversations: { conversationId: string }[] }>("GET", "/api/conversations")).conversations.map((c) => c.conversationId);

async function signIn() {
  await waitFor("Sign in", 240_000);
  await clearField("Email");
  await typeInto("Email", credentials.email);
  await clearField("Password");
  await typeInto("Password", credentials.password);
  await hideKeyboard();
  const labelled = await findAll("Sign in");
  const button = labelled[labelled.length - 1];
  await tapAt(Math.round((button.x1 + button.x2) / 2), Math.round((button.y1 + button.y2) / 2));
  await sleep(2500);
  if (await has("Save password to Google Password Manager?")) await back();
  await waitFor("Enter your 6-digit code", 30_000);
  await clearField("Code");
  await typeInto("Code", await freshCode());
  await hideKeyboard();
  await tap("Verify");
}

async function launch() {
  forceStop();
  await openApp(METRO);
  await sleep(6000);
  if (await has("Go home")) await back();
}

const tab = (title: string) => tap(new RegExp(`^${title}(,|$)`), 30_000);
const scrollDown = () => {
  const [w, h] = screenSize();
  return swipe(Math.round(w / 2), Math.round(h * 0.75), Math.round(w / 2), Math.round(h * 0.3));
};
/** Scrolls down until `label` is on screen (a long form). */
async function scrollTo(label: string) {
  for (let i = 0; i < 8 && !(await has(label)); i++) await scrollDown();
  expect(await has(label), label).toBe(true);
}

describe("chat and recipes on a device", () => {
  beforeEach((ctx) => {
    onTestFailed(async () => {
      await screenshot(`FAILED-${ctx.task.name.slice(0, 40).replace(/[^a-z0-9]+/gi, "-")}`).catch(() => {});
    });
  });

  beforeAll(async () => {
    adb(["devices"]);
    adb(["reverse", "tcp:8088", "tcp:8088"]);
    adb(["reverse", "tcp:3009", "tcp:3009"]);
    setAnimations(true);
    setFontScale(1.0);
    setDarkMode(false);
    await setRotation(false);
    adb(["shell", "wm", "density", "reset"]);
    clearApp();
    await m.signIn();
    recipesBefore = await myRecipeIds();
    conversationsBefore = await conversationIds();
    await launch();
  });

  afterAll(async () => {
    adb(["shell", "wm", "density", "reset"]);
    for (const id of (await myRecipeIds().catch(() => [])).filter((id) => !recipesBefore.includes(id))) await m.client.request("DELETE", `/api/recipes/${id}`).catch(() => {});
    for (const id of (await conversationIds().catch(() => [])).filter((id) => !conversationsBefore.includes(id))) await m.client.request("DELETE", `/api/conversations/${id}`).catch(() => {});
  });

  it("C1 signs in and shows the Ask and Recipes tabs", async () => {
    await signIn();
    await waitFor(/^Ask(,|$)/, 60_000);
    expect(await has(/^Recipes(,|$)/)).toBe(true);
    await screenshot("c01-tabs");
  });

  it("C2 streams an answer that grows on screen, with Stop while it streams, then saves it", async () => {
    await tab("Ask");
    await waitFor("New conversation", 30_000);
    await screenshot("c02-conversations-empty");
    await tap("New conversation");
    await waitFor("My hollandaise split. How do I fix it?", 20_000);
    await screenshot("c03-new-conversation");
    await tap("My hollandaise split. How do I fix it?");
    await waitFor("Stop", 20_000);
    // The proof that the answer streams on this phone: its length on screen, read again and again until Send is back.
    const samples: number[] = [];
    let shot = false;
    for (const until = Date.now() + 90_000; Date.now() < until; ) {
      const onScreen = await texts();
      samples.push(Math.max(0, ...onScreen.filter((t) => t.includes("Fake kitchen answer")).map((t) => t.length)));
      if (!shot && samples[samples.length - 1] > 0) {
        await screenshot("c04-streaming");
        shot = true;
      }
      if (onScreen.includes("Send")) break;
    }
    console.log(`answer length on screen while streaming: ${samples.join(", ")}`);
    const steps = new Set(samples.filter((n) => n > 0));
    expect(steps.size, `the answer grew on screen in several steps: ${samples.join(", ")}`).toBeGreaterThanOrEqual(3);
    await screenshot("c05-answered");
  });

  it("C3 Stop keeps what arrived", async () => {
    await typeInto("Your question", "Another one please");
    await tap("Send");
    await waitFor(/Fake kitchen answer to: Another/, 30_000);
    await tap("Stop");
    await waitFor("Stopped.", 20_000);
    await screenshot("c06-stopped");
  });

  it("C4 a failed answer is said plainly, with Try again", async () => {
    await typeInto("Your question", "This one fails [fake:fail]");
    await tap("Send");
    await waitFor(/couldn't finish this answer|isn't available right now/, 90_000);
    expect(await has("Try again")).toBe(true);
    await screenshot("c07-failed");
  });

  it("C5 the conversation is listed, as on the web", async () => {
    await tap("Back to conversations");
    await waitFor(/^your conversations$/i, 20_000);
    await waitFor(/My hollandaise split/, 20_000);
    await screenshot("c08-conversations");
  });

  it("R1 My Recipes and the Recipe Lab form", async () => {
    await tab("Recipes");
    await waitFor("Create a recipe", 30_000);
    await screenshot("r01-my-recipes");
    await tap("Create a recipe");
    await waitFor("What would you like to create?", 20_000);
    await screenshot("r02-lab-form");
  });

  it("R2 the wait is shown with Stop, and Stop saves nothing", async () => {
    await typeInto("What would you like to create?", "Chicken braise with cider");
    await hideKeyboard();
    await scrollTo("Generate recipe");
    await tap("Generate recipe");
    await waitFor("Writing your recipe…", 20_000);
    await sleep(2000);
    await screenshot("r03-lab-waiting");
    await tap("Stop");
    await waitFor("Stopped. Nothing was saved.", 20_000);
    await screenshot("r04-lab-stopped");
    expect(await myRecipeIds()).toEqual(recipesBefore);
  });

  it("R3 a made recipe opens, with the owner's public switch", async () => {
    await scrollTo("Generate recipe");
    await tap("Generate recipe");
    await waitFor("Cider-braised chicken thighs", 60_000);
    expect((await myRecipeIds()).filter((id) => !recipesBefore.includes(id))).toHaveLength(1);
    await screenshot("r05-recipe");
    await tap("Public");
    await waitFor(/listed in the community gallery/, 20_000);
    await scrollDown();
    await screenshot("r06-recipe-method");
  });

  it("R4 a refinement is shown before anything is saved", async () => {
    await scrollTo("Make dairy-free");
    await tap("Make dairy-free");
    await hideKeyboard();
    await scrollTo("Refine");
    await tap("Refine");
    await waitFor("Antoine is refining your recipe…", 20_000);
    await screenshot("r07-refining");
    await waitFor(/^what changed$/i, 60_000);
    await screenshot("r08-refine-proposal");
    await scrollTo("Accept changes");
    await tap("Accept changes");
    await sleep(3000);
    await back();
    await waitFor("My Recipes", 20_000);
    await screenshot("r09-my-recipes");
  });

  it("T1 the same screens at iPad width (820 dp, portrait)", async () => {
    const [w] = screenSize();
    adb(["shell", "wm", "density", String(Math.round((w / 820) * 160))]);
    await sleep(3000);
    await screenshot("t01-my-recipes-ipad");
    await tap(/^Cider-braised chicken thighs/);
    await waitFor(/^who can see it$/i, 20_000);
    await screenshot("t02-recipe-ipad");
    await back();
    await tap("Create a recipe");
    await waitFor("What would you like to create?", 20_000);
    await screenshot("t03-lab-ipad");
    await back();
    await tab("Ask");
    await waitFor(/^your conversations$/i, 20_000);
    await screenshot("t04-conversations-ipad");
    await tap(/^My hollandaise split/);
    await waitFor(/Fake kitchen answer/, 20_000);
    await screenshot("t05-conversation-ipad");
    adb(["shell", "wm", "density", "reset"]);
  });
});

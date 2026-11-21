/**
 * What the device tests need on the server, made through the same API the web uses: a manager (the E2E user) creates
 * items and storage areas, opens a stock take by area, and later approves it so nothing is left open.
 * The phone is signed in separately, by hand, as a chef would.
 */

import { generate } from "otplib";
import { createApiClient, type Tokens } from "../src/api/client";

const baseUrl = () => process.env.E2E_API_URL ?? "http://localhost:3009";
const API = "/api/inventory";

/** Read when used, not when imported, so a script can load .env.test first. */
export const credentials = {
  get email() { return process.env.E2E_USER_EMAIL ?? ""; },
  get password() { return process.env.E2E_USER_PASSWORD ?? ""; },
  get totpSecret() { return process.env.E2E_USER_TOTP_SECRET ?? ""; },
};

/**
 * A one-time code for the app, generated as late as possible: it is only valid for the rest of its 30-second window,
 * and typing it into the phone takes several seconds. Waits for a window that is not the one already used and that
 * has at least 12 seconds left, so a code can never expire between generating it and pressing Verify.
 */
let lastWindow = -1;
export async function freshCode(): Promise<string> {
  const window = () => Math.floor(Date.now() / 30_000);
  const msLeft = () => 30_000 - (Date.now() % 30_000);
  while (window() === lastWindow || msLeft() < 12_000) await new Promise((r) => setTimeout(r, 500));
  lastWindow = window();
  return generate({ secret: credentials.totpSecret });
}

export function manager() {
  let tokens: Tokens | null = null;
  const client = createApiClient({
    baseUrl: baseUrl(),
    appVersion: "0.1.0-device",
    tokenStore: { load: async () => tokens, save: async (t) => void (tokens = t), clear: async () => void (tokens = null) },
  });
  return {
    client,
    async signIn() {
      const login = await client.request<{ mfaSessionToken: string }>("POST", "/api/auth/login", { auth: false, body: { email: credentials.email, password: credentials.password } });
      const done = await client.request<{ tokens: Tokens }>("POST", "/api/auth/mfa/verify", { auth: false, body: { mfaSessionToken: login.mfaSessionToken, code: await freshCode() } });
      tokens = done.tokens;
    },
  };
}

export interface AreaFixture {
  sessionId: string;
  tag: string;
  /** Bar and Cellar both hold `shared`; Pantry holds `solo` only. */
  areas: { bar: string; cellar: string; pantry: string; bulk: string };
  items: { shared: string; sharedId: string; solo: string; soloId: string; extra: string[]; bulk: string[] };
  /** The manager's own API client, for the test to change the server's side while the phone is offline. */
  api: ReturnType<typeof manager>["client"];
  locationId: string;
  cleanup(): Promise<void>;
}

/** Four areas (Bulk holds 25 plain items, for the stress run) and a stock take open on all of them. The names carry a tag so reruns never collide. */
export async function seedAreaCount(): Promise<AreaFixture> {
  const m = manager();
  await m.signIn();
  const { client } = m;
  const tag = `dv${Date.now().toString(36).slice(-5)} `;
  const locationId = (await client.request<{ selectedLocationId: string }>("GET", "/api/users/location-context")).selectedLocationId;
  const open = await client.request<{ sessionId: string; sessionStatus: string } | null>("GET", `${API}/stock-takes/active`);
  if (open) {
    throw new Error(`A stock take is already open at this location (${open.sessionId}, ${open.sessionStatus}). A device run that died halfway leaves one behind: finish or approve it on the web before running again.`);
  }

  const mk = async (name: string) =>
    (await client.request<{ ingredientId: string }>("POST", `${API}/ingredients`, { body: { ingredientName: `${tag}${name}`, ingredientCategory: "produce", baseUnit: "kg", unitCost: "1.00" } })).ingredientId;
  const sharedId = await mk("Shiraz");
  const soloId = await mk("Flour");
  const extraIds = [await mk("Salt"), await mk("Sugar"), await mk("Rice")];

  const areaIds: string[] = [];
  const makeArea = async (name: string, sortOrder: number, ids: string[]) => {
    const a = await client.request<{ storageAreaId: string }>("POST", `${API}/locations/${locationId}/storage-areas`, { body: { areaName: `${tag}${name}`, sortOrder } });
    areaIds.push(a.storageAreaId);
    await client.request("PUT", `${API}/storage-areas/${a.storageAreaId}/items`, { body: { items: ids.map((ingredientId) => ({ ingredientId })) } });
    return `${tag}${name}`;
  };
  const bar = await makeArea("Bar", 940, [sharedId]);
  const cellar = await makeArea("Cellar", 941, [sharedId]);
  const pantry = await makeArea("Pantry", 942, [soloId, ...extraIds]);
  const bulkNames = Array.from({ length: 25 }, (_, i) => `Item${String(i + 1).padStart(2, "0")}`);
  const bulkIds: string[] = [];
  for (const n of bulkNames) bulkIds.push(await mk(n));
  const bulk = await makeArea("Bulk", 943, bulkIds);

  const opened = await client.request<{ sessionId: string }>("POST", `${API}/stock-takes`, { body: { mode: "AREA", categories: [bar, cellar, pantry, bulk] } });

  return {
    sessionId: opened.sessionId,
    tag,
    areas: { bar, cellar, pantry, bulk },
    items: { shared: `${tag}Shiraz`, sharedId, solo: `${tag}Flour`, soloId, extra: ["Salt", "Sugar", "Rice"].map((n) => `${tag}${n}`), bulk: bulkNames.map((n) => `${tag}${n}`) },
    api: client,
    locationId,
    async cleanup() {
      // Finish the stock take whatever state a run left it in, so the next run can open its own: claim and submit every
      // area still open (counting shared items as zero, which the shared-item rule requires), then approve.
      const detail = () => client.request<{ sessionStatus: string; categories: Array<{ categoryName: string; categoryStatus: string; claimRevision: number }> }>("GET", `${API}/stock-takes/${opened.sessionId}`);
      const base = `${API}/stock-takes/${opened.sessionId}/categories`;
      try {
        for (const c of (await detail()).categories.filter((x) => x.categoryStatus !== "SUBMITTED" && x.categoryStatus !== "APPROVED")) {
          const name = encodeURIComponent(c.categoryName);
          if (c.categoryStatus === "NOT_STARTED") await client.request("POST", `${base}/${name}/claim`).catch(() => {});
          const rev = (await detail()).categories.find((x) => x.categoryName === c.categoryName)!.claimRevision;
          if (c.categoryName === bar || c.categoryName === cellar) {
            await client.request("POST", `${base}/${name}/lines`, { body: { ingredientId: sharedId, rawQty: 0, countedUnit: "kg", claimRevision: rev } }).catch(() => {});
          }
          await client.request("POST", `${base}/${name}/submit`, { body: { claimRevision: rev } }).catch(() => {});
        }
        let s = await detail();
        if (s.sessionStatus === "OPEN") await client.request("POST", `${API}/stock-takes/${opened.sessionId}/submit-for-review`).catch(() => {});
        s = await detail();
        if (s.sessionStatus === "PENDING_REVIEW") await client.request("POST", `${API}/stock-takes/${opened.sessionId}/approve`);
      } catch (err) {
        console.warn("fixture cleanup could not finish the stock take:", String(err).slice(0, 200));
      }
      for (const id of areaIds.reverse()) await client.request("DELETE", `${API}/storage-areas/${id}`).catch(() => {});
    },
  };
}

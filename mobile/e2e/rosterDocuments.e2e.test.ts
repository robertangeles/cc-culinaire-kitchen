import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ApiError, createApiClient, type Tokens } from "../src/api/client";
import { createAccountApi } from "../src/api/account";
import { createAuthApi } from "../src/api/auth";
import { createSession } from "../src/auth/session";
import { createComplianceApi } from "../src/compliance/complianceApi";
import { createDocumentStore } from "../src/compliance/documentStore";
import { uploadMessage } from "../src/compliance/documentView";
import { newUuid } from "../src/outbox/uuid";
import { createAvailabilityStore } from "../src/roster/availabilityStore";
import { createRosterApi } from "../src/roster/rosterApi";
import { createRosterStore } from "../src/roster/rosterStore";
import { published, shownSwaps } from "../src/roster/shiftView";
import { manager } from "../device/fixtures";

/**
 * The staff side of the roster and of documents against a real server, with the phone's own code and no UI. A manager (the E2E user)
 * builds and publishes shifts; a person who just joined with a plain account answers them, offers one for swap, claims one, keeps their
 * availability and sends a certificate for review. Same server and user as `storePlumbing.e2e.test.ts`.
 * A stored photo needs Cloudinary, so an upload is only tried with a file the server refuses; the record names a file that does not exist.
 */
const { E2E_USER_EMAIL, E2E_USER_PASSWORD, E2E_USER_TOTP_SECRET } = process.env;
const baseUrl = process.env.E2E_API_URL ?? "http://localhost:3009";
const PASSWORD = "Phone-Roster-Pass-1!";
const email = `ph-roster-${Date.now().toString(36)}@culinaire.test`;
const HOUR = 3_600_000;

describe.skipIf(!process.env.CI && (!E2E_USER_EMAIL || !E2E_USER_PASSWORD || !E2E_USER_TOTP_SECRET))("roster and documents against the real server", () => {
  let tokens: Tokens | null = null;
  const tokenStore = { load: async () => tokens, save: async (t: Tokens) => void (tokens = t), clear: async () => void (tokens = null) };
  const client = createApiClient({ baseUrl, tokenStore, appVersion: "0.1.0-e2e", timeoutMs: 20_000 });
  const authApi = createAuthApi(client, tokenStore);
  const session = createSession({ api: authApi, hasTokens: async () => tokens !== null, snapshots: { load: async () => null, save: async () => {} } });
  const m = manager();
  const roster = createRosterStore({ api: createRosterApi(client), now: Date.now });
  const shiftIds: string[] = [];
  let roleId = "";
  let locationId = "";
  let organisationId = 0;
  let staffId = 0;
  let managerId = 0;

  /** A shift `inHours` from now, assigned to `userId`; published unless it is left a draft. */
  async function shift(inHours: number, userId: number) {
    const start = Date.now() + inHours * HOUR;
    const made = await m.client.request<{ shiftId: string }>("POST", "/api/roster/shifts", { body: { storeLocationId: locationId, rosterRoleId: roleId, startDatetime: new Date(start).toISOString(), endDatetime: new Date(start + 8 * HOUR).toISOString() } });
    shiftIds.push(made.shiftId);
    const a = await m.client.request<{ assignmentId: string }>("POST", `/api/roster/shifts/${made.shiftId}/assignments`, { body: { userId } });
    return { shiftId: made.shiftId, assignmentId: a.assignmentId };
  }
  const day = (inDays: number) => new Date(Date.now() + inDays * 24 * HOUR).toISOString().slice(0, 10);
  let first!: { shiftId: string; assignmentId: string };
  let offered!: { shiftId: string; assignmentId: string };
  let draftSwap = "";
  let draft!: { shiftId: string; assignmentId: string };

  beforeAll(async () => {
    await m.signIn();
    const org = (await m.client.request<{ organisation: { organisationId: number; joinKey: string } }>("GET", "/api/organisations/mine")).organisation;
    organisationId = org.organisationId;
    locationId = (await m.client.request<{ locations: { storeLocationId: string }[] }>("GET", "/api/store-locations/mine")).locations[0].storeLocationId;
    const storeKey = (await m.client.request<{ storeLocation: { storeKey: string } }>("GET", `/api/store-locations/${locationId}`)).storeLocation.storeKey;
    managerId = (await m.client.request<{ user: { userId: number } }>("GET", "/api/auth/me")).user.userId;

    await authApi.register("Phone Roster", email, PASSWORD);
    await session.signIn(email, PASSWORD);
    await session.joinOrganisation(org.joinKey);
    await session.joinLocation(storeKey);
    const state = session.getSnapshot().state;
    if (state.phase !== "ready") throw new Error(`not signed in: ${state.phase}`);
    staffId = state.user.userId;

    roleId = (await m.client.request<{ rosterRoleId: string }>("POST", "/api/roster/roles", { body: { roleName: `Phone E2E ${Date.now().toString(36)}` } })).rosterRoleId;
    first = await shift(30, staffId);
    offered = await shift(54, managerId);
    await m.client.request("POST", `/api/roster/assignments/${offered.assignmentId}/respond`, { body: { response: "Confirmed" } });
    await m.client.request("POST", "/api/roster/publish", { body: { storeLocationId: locationId, from: day(0), to: day(5) } });
    draft = await shift(78, staffId);
    // A colleague's draft, offered for swap (the web allows it).
    const colleagues = await shift(82, managerId);
    await m.client.request("POST", `/api/roster/assignments/${colleagues.assignmentId}/respond`, { body: { response: "Confirmed" } });
    draftSwap = (await m.client.request<{ swapRequestId: string }>("POST", "/api/workforce/swaps", { body: { assignmentId: colleagues.assignmentId } })).swapRequestId;
    await roster.refresh();
  });

  afterAll(async () => {
    // Cancel what was made, then remove the account the way the app does.
    for (const id of shiftIds) await m.client.request("POST", `/api/roster/shifts/${id}/cancel`).catch(() => {});
    if (tokens) await createAccountApi(client, tokenStore).deleteAccount({ password: PASSWORD }).catch(() => {});
  });

  const mine = (assignmentId: string) => roster.getSnapshot().shifts.find((s) => s.assignmentId === assignmentId);

  it("lists the person's published shift with its venue's zone, and no draft", () => {
    expect(roster.getSnapshot()).toMatchObject({ phase: "ready", off: false });
    expect(mine(first.assignmentId)).toMatchObject({ assignmentStatus: "Pending", status: "Published" });
    expect(mine(first.assignmentId)?.ianaTimezone).toMatch(/\//);
    expect(published(roster.getSnapshot().shifts).some((s) => s.shiftId === draft.shiftId)).toBe(false);
  });

  it("confirms the shift, and a repeat of the same answer is a success, the other answer is refused", async () => {
    expect(await roster.respond(first.assignmentId, "Confirmed")).toBe(true);
    expect(await roster.respond(first.assignmentId, "Confirmed")).toBe(true);
    expect(await roster.respond(first.assignmentId, "Declined")).toBe(false);
    expect(mine(first.assignmentId)?.assignmentStatus).toBe("Confirmed");
  });

  it("offers it, is told the repeat is already done, and takes it back", async () => {
    expect(await roster.offer(first.assignmentId)).toBe(true);
    expect(await roster.offer(first.assignmentId)).toBe(true);
    expect(await roster.cancelOffer(first.assignmentId)).toBe(true);
    expect(roster.mySwap(first.assignmentId)).toBeUndefined();
  });

  it("claims a colleague's shift, whose time is known because the person works there; the repeat is a success", async () => {
    await m.client.request("POST", "/api/workforce/swaps", { body: { assignmentId: offered.assignmentId } });
    await roster.refresh();
    const swap = roster.getSnapshot().swaps!.find((s) => s.shiftId === offered.shiftId)!;
    const state = session.getSnapshot().state;
    // Shown on its own venue's clock with nothing but what the server sends; a swap of a draft is not shown at all.
    expect(roster.getSnapshot().swaps!.find((s) => s.swapRequestId === draftSwap)?.shiftStatus).toBe("Draft");
    const { shown } = shownSwaps(roster.getSnapshot().swaps!, state.phase === "ready" ? state.user.userId : 0, [], [], Date.now());
    expect(shown.map((s) => s.shiftId)).toEqual([offered.shiftId]);
    expect(shown[0]).toMatchObject({ shiftStatus: "Published", ianaTimezone: expect.stringMatching(/\//), locationName: expect.any(String) });
    expect(await roster.claim(swap)).toBe(true);
    expect(roster.getSnapshot().shifts.some((s) => s.shiftId === offered.shiftId && s.assignmentStatus === "Confirmed")).toBe(true);
    expect(await roster.claim(swap)).toBe(true);
  });

  it("keeps availability: a repeated add makes one row, a change and a removal follow, and a removal of what is gone is done", async () => {
    const api = createRosterApi(client);
    const availability = createAvailabilityStore(api);
    const window = { storeLocationId: null, dayOfWeek: 2, availableFrom: "09:00", availableUntil: "17:00", effectiveFrom: day(0), effectiveUntil: null };
    await availability.add(window);
    await availability.add(window);
    const [row, ...others] = availability.getSnapshot().rows;
    expect(others).toEqual([]);
    expect(row).toMatchObject(window);
    await availability.change(row.staffAvailabilityId, { ...window, availableFrom: "10:00" });
    expect(availability.getSnapshot().rows[0].availableFrom).toBe("10:00");
    await availability.add(window);
    await expect(availability.change(row.staffAvailabilityId, window)).rejects.toMatchObject({ serverCode: "CONFLICT" });
    for (const r of [...availability.getSnapshot().rows]) await availability.remove(r.staffAvailabilityId);
    await availability.remove(row.staffAvailabilityId);
    expect(await api.availability()).toEqual([]);
  });

  it("says what is wrong with a file that is not a photo", async () => {
    const form = new FormData();
    form.append("file", new Blob(["this is a plain text file, not a photo"], { type: "image/jpeg" }), "x.jpg");
    const err = await client.request("POST", "/api/compliance/documents/upload", { body: form }).catch((e: unknown) => e);
    expect(uploadMessage(err)).toMatch(/JPEG or PNG/);
  });

  it("sends a certificate, finds it again when the answer is lost, changes it, and cannot remind a manager yet", async () => {
    const api = createComplianceApi(client);
    let lost = true;
    const docs = createDocumentStore({
      ...api,
      create: async (d) => {
        await api.create(d);
        if (lost) throw new ApiError("timeout");
      },
    });
    await docs.send({ documentType: "RSA", engagementType: "employee", documentNumber: "E2E-1", issueDate: "2026-01-02", expiryDate: null, issuingJurisdiction: "VIC", storagePublicId: `culinaire/compliance/org-${organisationId}/user-${staffId}/e2ephone`, storageFormat: "jpg" });
    lost = false;
    expect(docs.getSnapshot().docs).toHaveLength(1);
    const [doc] = docs.getSnapshot().docs;
    expect(doc).toMatchObject({ documentType: "RSA", verificationStatus: "Pending", issueDate: "2026-01-02" });
    await docs.update(doc.complianceDocumentId, { documentNumber: "E2E-2", issueDate: "2026-01-02", expiryDate: "2029-01-02", issuingJurisdiction: null });
    expect(docs.find(doc.complianceDocumentId)).toMatchObject({ documentNumber: "E2E-2", expiryDate: "2029-01-02", issuingJurisdiction: null });
    await expect(docs.nudge(doc.complianceDocumentId)).rejects.toMatchObject({ code: "conflict" });
    await expect(docs.update(newUuid(), { documentNumber: null, issueDate: null, expiryDate: null, issuingJurisdiction: null })).rejects.toMatchObject({ code: "not_found" });
  });
});

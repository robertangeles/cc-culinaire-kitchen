import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { organisation, user, userOrganisation, storeLocation, prepSession, prepTask } from "../db/schema.js";
import { getStationDemand } from "./workforceDemandService.js";

/**
 * Real-database behaviour of workforceDemandService (Phase 3, Slice 1).
 * Gated on TENANT_IT=1, same convention as roster.integration.test.ts.
 */
const RUN = process.env.TENANT_IT === "1";

const tag = `wfd_${Date.now().toString(36)}`;
const STATION = `${tag}-station`;

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const TODAY = new Date().toISOString().slice(0, 10);

describe.skipIf(!RUN)("workforceDemandService (real DB)", () => {
  let orgA: number;
  let orgB: number;
  let userA: number;
  let locA: string;
  let locB: string;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    [{ id: userA }] = await db
      .insert(user)
      .values({ userName: "Workforce Demand Owner", userEmail: `${tag}-a@it.test` })
      .returning({ id: user.userId });

    [{ id: orgA }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-A`, joinKey: `${tag}-ka`.slice(0, 25), createdBy: userA })
      .returning({ id: organisation.organisationId });
    [{ id: orgB }] = await db
      .insert(organisation)
      .values({ organisationName: `${tag}-B`, joinKey: `${tag}-kb`.slice(0, 25), createdBy: userA })
      .returning({ id: organisation.organisationId });

    await db.insert(userOrganisation).values([{ userId: userA, organisationId: orgA, role: "admin" }]);

    [{ id: locA }] = await db
      .insert(storeLocation)
      .values({ organisationId: orgA, locationName: `${tag}-locA`, storeKey: `${tag}-ska`.slice(0, 25), createdBy: userA })
      .returning({ id: storeLocation.storeLocationId });
    [{ id: locB }] = await db
      .insert(storeLocation)
      .values({ organisationId: orgB, locationName: `${tag}-locB`, storeKey: `${tag}-skb`.slice(0, 25), createdBy: userA })
      .returning({ id: storeLocation.storeLocationId });

    // 3 historical days, each: 40 covers, 60 prep minutes at STATION.
    // total minutes = 180, total covers = 120 -> 1.5 min/cover.
    for (let i = 3; i >= 1; i--) {
      const [session] = await db
        .insert(prepSession)
        .values({ userId: userA, organisationId: orgA, storeLocationId: locA, prepDate: addDays(TODAY, -i), actualCovers: 40 })
        .returning({ id: prepSession.prepSessionId });
      sessionIds.push(session.id);
      await db.insert(prepTask).values({
        prepSessionId: session.id,
        userId: userA,
        taskDescription: `${tag} prep task`,
        ingredientName: `${tag} ingredient`,
        quantityNeeded: "1.000",
        unit: "kg",
        prepTimeMinutes: 60,
        priorityScore: "1.00",
        priorityTier: "medium",
        station: STATION,
      });
    }

    // Target date: expectedCovers = 100, no actualCovers yet (session not ended).
    const [targetSession] = await db
      .insert(prepSession)
      .values({ userId: userA, organisationId: orgA, storeLocationId: locA, prepDate: TODAY, expectedCovers: 100 })
      .returning({ id: prepSession.prepSessionId });
    sessionIds.push(targetSession.id);
  });

  afterAll(async () => {
    if (sessionIds.length) {
      const ids = sessionIds;
      await db.delete(prepTask).where(inArray(prepTask.prepSessionId, ids));
      await db.delete(prepSession).where(inArray(prepSession.prepSessionId, ids));
    }
    if (locA) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locA));
    if (locB) await db.delete(storeLocation).where(eq(storeLocation.storeLocationId, locB));
    if (orgA && orgB) {
      await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, [orgA, orgB]));
      await db.delete(organisation).where(inArray(organisation.organisationId, [orgA, orgB]));
    }
    if (userA) await db.delete(user).where(eq(user.userId, userA));
  });

  it("recommends hours per station that reconcile against the known prep sessions (T17's own verify criterion)", async () => {
    const result = await getStationDemand(orgA, locA, TODAY);
    expect(result.targetCovers).toBe(100);
    expect(result.inputsNotUsed).toEqual(["sale"]);

    const station = result.stations.find((s) => s.station === STATION);
    expect(station).toBeDefined();
    // 1.5 min/cover x 100 covers = 150 min = 2.5h exactly.
    expect(station!.recommendedHours).toBe(2.5);
    expect(station!.basedOnDays).toBe(3);
    // forecastConfidence(3, 30) = 0.1
    expect(station!.confidence).toBe(0.1);
  });

  it("404s when no prep session exists for the target date", async () => {
    await expect(getStationDemand(orgA, locA, addDays(TODAY, 30))).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 404,
    });
  });

  it("404s a location in another org rather than confirming it exists", async () => {
    await expect(getStationDemand(orgA, locB, TODAY)).rejects.toMatchObject({
      name: "RosterError",
      statusCode: 404,
    });
  });

  it("excludes the target date's own tasks from its historical window (no circular reasoning)", async () => {
    // Add a huge, obviously-distinguishing prep_task on the TARGET date itself.
    await db.insert(prepTask).values({
      prepSessionId: sessionIds[sessionIds.length - 1],
      userId: userA,
      taskDescription: `${tag} same-day task`,
      ingredientName: `${tag} ingredient`,
      quantityNeeded: "1.000",
      unit: "kg",
      prepTimeMinutes: 99999,
      priorityScore: "1.00",
      priorityTier: "medium",
      station: STATION,
    });

    const result = await getStationDemand(orgA, locA, TODAY);
    const station = result.stations.find((s) => s.station === STATION);
    // Unchanged from the first test — the same-day task must not have leaked
    // into its own historical average.
    expect(station!.recommendedHours).toBe(2.5);
    expect(station!.basedOnDays).toBe(3);
  });
});

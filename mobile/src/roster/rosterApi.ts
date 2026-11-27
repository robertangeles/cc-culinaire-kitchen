import { AvailabilityListSchema, MyShiftsSchema, OpenSwapsSchema, type Availability, type MyShift, type OpenSwap } from "@culinaire/shared/schemas/roster";
import type { ApiClient } from "../api/client";
import type { AvailabilityWindow } from "./availabilityView";

/** The staff side of the roster. Every call is online: nothing is queued, and the last answer of a read is kept sealed by `lockedCache` (owner, Q6). */
export function createRosterApi(client: ApiClient) {
  const id = encodeURIComponent;
  return {
    /** The person's shifts from `from` (a calendar day on each shift's own venue's clock) on. Drafts are left out by the server, but for those with a consent question. */
    shifts(from: string): Promise<MyShift[]> {
      return client.request("GET", `/api/roster/shifts/mine?excludeDrafts=true&from=${id(from)}&limit=500`, { schema: MyShiftsSchema });
    },
    async respond(assignmentId: string, response: "Confirmed" | "Declined"): Promise<void> {
      await client.request("POST", `/api/roster/assignments/${id(assignmentId)}/respond`, { body: { response } });
    },
    async consent(assignmentId: string, response: "Accepted" | "Declined"): Promise<void> {
      await client.request("POST", `/api/roster/assignments/${id(assignmentId)}/consent/respond`, { body: { response } });
    },
    /** Every open offer in the organisation, the person's own among them. */
    swaps(): Promise<OpenSwap[]> {
      return client.request("GET", "/api/workforce/swaps", { schema: OpenSwapsSchema });
    },
    async offer(assignmentId: string): Promise<void> {
      await client.request("POST", "/api/workforce/swaps", { body: { assignmentId } });
    },
    async claim(swapRequestId: string): Promise<void> {
      await client.request("POST", `/api/workforce/swaps/${id(swapRequestId)}/claim`);
    },
    async cancelSwap(swapRequestId: string): Promise<void> {
      await client.request("POST", `/api/workforce/swaps/${id(swapRequestId)}/cancel`);
    },
    availability(): Promise<Availability[]> {
      return client.request("GET", "/api/roster/availability/mine", { schema: AvailabilityListSchema });
    },
    async addAvailability(window: AvailabilityWindow): Promise<void> {
      await client.request("POST", "/api/roster/availability", { body: window });
    },
    async changeAvailability(staffAvailabilityId: string, window: AvailabilityWindow): Promise<void> {
      await client.request("PUT", `/api/roster/availability/${id(staffAvailabilityId)}`, { body: window });
    },
    async removeAvailability(staffAvailabilityId: string): Promise<void> {
      await client.request("DELETE", `/api/roster/availability/${id(staffAvailabilityId)}`);
    },
  };
}

export type RosterApi = ReturnType<typeof createRosterApi>;

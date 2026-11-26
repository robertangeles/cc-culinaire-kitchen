import { z } from "zod";

/** Rows the phone cannot read are left out, so one bad row never empties a list. */
const list = <T extends z.ZodTypeAny>(row: T) => z.array(z.unknown()).transform((rows) => rows.flatMap((r) => { const p = row.safeParse(r); return p.success ? [p.data as z.infer<T>] : []; }));

/** One row of `GET /api/roster/shifts/mine`. Times are instants; `ianaTimezone` is the venue's zone, the only one they are shown in. */
export const MyShiftSchema = z.object({
  shiftId: z.string(),
  assignmentId: z.string(),
  storeLocationId: z.string(),
  locationName: z.string().catch(""),
  ianaTimezone: z.string().catch(""),
  roleName: z.string().catch(""),
  startDatetime: z.string(),
  endDatetime: z.string(),
  status: z.string().catch(""),
  isPublicHoliday: z.boolean().catch(false),
  /** Pending, Confirmed or Declined. */
  assignmentStatus: z.string().catch(""),
  /** Requested, Accepted, Declined, or null when nobody asked. */
  publicHolidayConsent: z.string().nullable().catch(null),
});
export type MyShift = z.infer<typeof MyShiftSchema>;
export const MyShiftsSchema = list(MyShiftSchema);

/** One row of `GET /api/workforce/swaps`: an open offer at any venue of the organisation, of shifts in any status. */
export const OpenSwapSchema = z.object({
  swapRequestId: z.string(),
  shiftId: z.string(),
  fromAssignmentId: z.string(),
  fromUserId: z.number(),
  fromUserName: z.string().catch(""),
  startDatetime: z.string(),
  endDatetime: z.string(),
  roleName: z.string().catch(""),
  storeLocationId: z.string(),
  /** Draft, Published or Cancelled. This and the venue's two are absent from a server that predates them. */
  shiftStatus: z.string().optional().catch(undefined),
  ianaTimezone: z.string().optional().catch(undefined),
  locationName: z.string().optional().catch(undefined),
});
export type OpenSwap = z.infer<typeof OpenSwapSchema>;
export const OpenSwapsSchema = list(OpenSwapSchema);

/** One row of `GET /api/roster/availability/mine`: a weekly window (0 is Sunday), on the venue's clock. */
export const AvailabilitySchema = z.object({
  staffAvailabilityId: z.string(),
  storeLocationId: z.string().nullable().catch(null),
  dayOfWeek: z.number().int().min(0).max(6),
  availableFrom: z.string(),
  availableUntil: z.string(),
  effectiveFrom: z.string(),
  effectiveUntil: z.string().nullable().catch(null),
});
export type Availability = z.infer<typeof AvailabilitySchema>;
export const AvailabilityListSchema = list(AvailabilitySchema);

/** The `code` of a 409 on claiming a swap (and `blocked` in the body for the compliance one). */
export const SWAP_CODES = {
  claimedByYou: "SWAP_CLAIMED_BY_YOU",
  claimedByOther: "SWAP_CLAIMED_BY_OTHER",
  cancelled: "SWAP_CANCELLED",
  alreadyAssigned: "SHIFT_ALREADY_ASSIGNED",
  blocked: "ASSIGNMENT_BLOCKED_COMPLIANCE",
} as const;
export const AssignmentBlockedBodySchema = z.object({ blocked: z.object({ documentType: z.string(), reason: z.string(), expiryDate: z.string().nullable().catch(null) }) });

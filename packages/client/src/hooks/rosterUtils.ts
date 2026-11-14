/**
 * @module hooks/rosterUtils
 *
 * HTTP-error parsing and request-cancellation helpers shared by the roster hooks.
 */

import { useCallback, useRef } from "react";

export interface AssignmentBlocked {
  documentType: string;
  reason: string;
  expiryDate: string | null;
}

export interface RoleVenueConflict {
  storeLocationId: string;
  locationName: string;
}

export async function parseError(
  res: Response,
  fallback: string,
): Promise<Error & { blocked?: AssignmentBlocked; conflicts?: RoleVenueConflict[] }> {
  const body = await res.json().catch(() => ({}));
  const err = new Error(typeof body.error === "string" ? body.error : fallback) as Error & {
    blocked?: AssignmentBlocked;
    conflicts?: RoleVenueConflict[];
  };
  if (body.blocked) err.blocked = body.blocked;
  if (body.conflicts) err.conflicts = body.conflicts;
  return err;
}

/**
 * Returns a function that aborts the previous request and hands back a fresh
 * signal. A refresh checks `signal.aborted` before touching state so a stale
 * response can never overwrite a newer one.
 */
export function useLatestSignal() {
  const ref = useRef<AbortController | null>(null);
  return useCallback(() => {
    ref.current?.abort();
    ref.current = new AbortController();
    return ref.current.signal;
  }, []);
}

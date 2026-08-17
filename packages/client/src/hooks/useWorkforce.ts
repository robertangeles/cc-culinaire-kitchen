/**
 * @module hooks/useWorkforce
 *
 * Custom hooks for Workforce Optimisation (Phase 3): demand forecasting.
 */

import { useState, useCallback, useEffect } from "react";
import type { AssignmentBlocked } from "./useRoster.js";

const API = import.meta.env.VITE_API_URL ?? "";
const BASE = `${API}/api/workforce`;
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

export interface StationDemand {
  station: string;
  recommendedHours: number;
  confidence: number;
  basedOnDays: number;
}

export interface WorkforceDemandResult {
  storeLocationId: string;
  forDate: string;
  targetCovers: number;
  stations: StationDemand[];
  inputsUsed: string[];
  inputsNotUsed: string[];
}

async function parseError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error || fallback);
}

export function useWorkforceDemand() {
  const [result, setResult] = useState<WorkforceDemandResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDemand = useCallback(async (storeLocationId: string, forDate: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/demand?storeLocationId=${storeLocationId}&forDate=${forDate}`, opts);
      if (!res.ok) throw await parseError(res, "Failed to load workforce demand");
      setResult(await res.json());
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Failed to load workforce demand");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { result, isLoading, error, fetchDemand };
}

export type CoverageCellStatus = "ok" | "unstaffed" | "missing" | "unverified" | "rejected" | "expired";

export interface CoverageCell {
  date: string;
  roleId: string;
  status: CoverageCellStatus;
  rosteredHours: number;
  detail: string | null;
}

export interface CoverageRole {
  roleId: string;
  roleName: string;
}

export interface StaffingCoverageResult {
  storeLocationId: string;
  from: string;
  to: string;
  roles: CoverageRole[];
  cells: CoverageCell[];
  summary: { covered: number; atRisk: number; unstaffed: number };
}

export function useStaffingCoverage() {
  const [result, setResult] = useState<StaffingCoverageResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCoverage = useCallback(async (storeLocationId: string, from: string, to: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/coverage?storeLocationId=${storeLocationId}&from=${from}&to=${to}`, opts);
      if (!res.ok) throw await parseError(res, "Failed to load staffing coverage");
      setResult(await res.json());
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Failed to load staffing coverage");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { result, isLoading, error, fetchCoverage };
}

// ─── Shift swap (Slice 3, staff self-service) ─────────────────────

export interface OpenSwap {
  swapRequestId: string;
  shiftId: string;
  fromAssignmentId: string;
  fromUserId: number;
  fromUserName: string;
  startDatetime: string;
  endDatetime: string;
  rosterRoleId: string;
  roleName: string;
  storeLocationId: string;
}

async function parseSwapError(res: Response, fallback: string): Promise<Error & { blocked?: AssignmentBlocked }> {
  const body = await res.json().catch(() => ({}));
  const err = new Error(body.error || fallback) as Error & { blocked?: AssignmentBlocked };
  if (body.blocked) err.blocked = body.blocked;
  return err;
}

export function useShiftSwaps() {
  const [swaps, setSwaps] = useState<OpenSwap[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/swaps`, opts);
      if (res.ok) setSwaps(await res.json());
      else setError((await parseSwapError(res, "Failed to load open swaps")).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const offer = useCallback(
    async (assignmentId: string) => {
      const res = await fetch(`${BASE}/swaps`, { ...jsonOpts, method: "POST", body: JSON.stringify({ assignmentId }) });
      if (!res.ok) throw await parseSwapError(res, "Failed to offer this shift for swap");
      await refresh();
    },
    [refresh],
  );

  const claim = useCallback(
    async (swapRequestId: string) => {
      const res = await fetch(`${BASE}/swaps/${swapRequestId}/claim`, { ...jsonOpts, method: "POST" });
      if (!res.ok) throw await parseSwapError(res, "Failed to claim this swap");
      await refresh();
    },
    [refresh],
  );

  const cancel = useCallback(
    async (swapRequestId: string) => {
      const res = await fetch(`${BASE}/swaps/${swapRequestId}/cancel`, { ...jsonOpts, method: "POST" });
      if (!res.ok) throw await parseSwapError(res, "Failed to cancel this swap offer");
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { swaps, isLoading, error, refresh, offer, claim, cancel };
}

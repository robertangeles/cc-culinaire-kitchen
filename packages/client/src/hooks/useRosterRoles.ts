/**
 * @module hooks/useRosterRoles
 *
 * Roles, document requirements, org members, public holidays, and award rules.
 */

import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL ?? "";
const BASE = `${API}/api/roster`;
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

// ─── Types ────────────────────────────────────────────────────────

export interface RosterRole {
  rosterRoleId: string;
  organisationId: number;
  storeLocationId: string | null;
  roleName: string;
  createdDttm: string;
  updatedDttm: string;
}

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

// ─── Roles ────────────────────────────────────────────────────────

export function useRosterRoles() {
  const [roles, setRoles] = useState<RosterRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Same fix as useShifts: RolesManager early-returns a full-page spinner
  // while isLoading is true, which would unmount an expanded RoleRow (and
  // its in-progress document-requirement edit) on every create/remove.
  // Only the true first load should show that spinner.
  const hasLoadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    if (!hasLoadedOnce.current) setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/roles`, opts);
      if (res.ok) setRoles(await res.json());
      else setError((await parseError(res, "Failed to load roles")).message);
    } finally {
      setIsLoading(false);
      hasLoadedOnce.current = true;
    }
  }, []);

  const create = useCallback(
    async (data: { roleName: string; storeLocationId?: string | null }) => {
      const res = await fetch(`${BASE}/roles`, { ...jsonOpts, method: "POST", body: JSON.stringify(data) });
      if (!res.ok) throw await parseError(res, "Failed to create role");
      const created = (await res.json()) as RosterRole;
      await refresh();
      return created;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, data: { roleName: string; storeLocationId?: string | null; confirmed?: boolean }) => {
      const res = await fetch(`${BASE}/roles/${id}`, { ...jsonOpts, method: "PUT", body: JSON.stringify(data) });
      if (!res.ok) throw await parseError(res, "Failed to update role");
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`${BASE}/roles/${id}`, { ...opts, method: "DELETE" });
      if (!res.ok) throw await parseError(res, "Failed to delete role");
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { roles, isLoading, error, refresh, create, update, remove };
}

/**
 * Standalone (not part of useRosterRoles's state) — a row-level component
 * managing its own role's document requirements must not call the full
 * useRosterRoles() hook just to reach these, or every rendered row would
 * trigger its own redundant GET /roles list refetch on mount.
 */
export async function getRoleDocuments(id: string): Promise<string[]> {
  const res = await fetch(`${BASE}/roles/${id}/documents`, opts);
  if (!res.ok) throw await parseError(res, "Failed to load document requirements");
  return res.json();
}

export async function setRoleDocuments(id: string, documentTypes: string[]): Promise<string[]> {
  const res = await fetch(`${BASE}/roles/${id}/documents`, {
    ...jsonOpts,
    method: "PUT",
    body: JSON.stringify({ documentTypes }),
  });
  if (!res.ok) throw await parseError(res, "Failed to update document requirements");
  return res.json();
}

// ─── Org members (staff picker for assignment) ────────────────────

export interface OrgMember {
  userId: number;
  displayName: string;
  photoPath: string | null;
}

export function useOrgMembers(orgId: number | null) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setMembers([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    fetch(`${API}/api/organisations/${orgId}/members`, opts)
      .then((res) => (res.ok ? res.json() : { members: [] }))
      .then((data) => {
        if (cancelled) return;
        setMembers(
          (data.members ?? []).map((m: { userId: number; displayName: string; photoPath: string | null }) => ({
            userId: m.userId,
            displayName: m.displayName,
            photoPath: m.photoPath,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return { members, isLoading };
}

// ─── Public holidays ──────────────────────────────────────────────

export interface PublicHoliday {
  publicHolidayId: string;
  jurisdiction: string;
  holidayDate: string;
  holidayName: string;
  isRegional: boolean;
  regionNote: string | null;
  sourceCitation: string | null;
  loadedForYear: number;
  partialDayFromTime: string | null;
  createdDttm: string;
  updatedDttm: string;
}

export interface NewPublicHoliday {
  jurisdiction: string;
  holidayDate: string;
  holidayName: string;
  isRegional?: boolean;
  regionNote?: string | null;
  sourceCitation?: string | null;
  loadedForYear: number;
  partialDayFromTime?: string | null;
}

export async function listPublicHolidays(): Promise<PublicHoliday[]> {
  const res = await fetch(`${BASE}/public-holidays`, opts);
  if (!res.ok) throw await parseError(res, "Failed to load public holidays");
  return res.json();
}

export async function createPublicHoliday(input: NewPublicHoliday): Promise<PublicHoliday> {
  const res = await fetch(`${BASE}/public-holidays`, {
    ...jsonOpts,
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseError(res, "Failed to add public holiday");
  return res.json();
}

export async function deletePublicHoliday(id: string): Promise<void> {
  const res = await fetch(`${BASE}/public-holidays/${id}`, { ...opts, method: "DELETE" });
  if (!res.ok) throw await parseError(res, "Failed to remove public holiday");
}

// ─── Award rules ──────────────────────────────────────────────────
// Same platform-wide shared shape as public holidays — no organisationId.

export const AWARD_RULE_TYPES = [
  "max_ordinary_hours",
  "publish_notice",
  "min_break",
  "min_rest",
  "penalty_rates",
  "allowances",
  "casual_loading",
  "overtime",
  "public_holiday_rates",
] as const;

/** Rule types this engine currently evaluates — the other 7 are honestly disclosed as not checked. */
export const AWARD_CHECKED_RULE_TYPES = ["max_ordinary_hours", "publish_notice"] as const;

export const AU_JURISDICTIONS = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"] as const;

export interface AwardRule {
  awardRuleId: string;
  awardCode: string;
  ruleType: string;
  jurisdiction: string | null;
  thresholdValue: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceCitation: string | null;
  ruleVersion: string;
}

export interface NewAwardRule {
  awardCode: string;
  ruleType: string;
  jurisdiction: string | null;
  thresholdValue: number;
  effectiveFrom: string;
  sourceCitation?: string | null;
}

export async function listAwardRules(): Promise<AwardRule[]> {
  const res = await fetch(`${BASE}/award-rules`, opts);
  if (!res.ok) throw await parseError(res, "Failed to load award rules");
  return res.json();
}

export async function upsertAwardRule(input: NewAwardRule): Promise<AwardRule> {
  const res = await fetch(`${BASE}/award-rules`, {
    ...jsonOpts,
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseError(res, "Failed to save award rule");
  return res.json();
}

// ─── Award rules CSV import ───────────────────────────────────────
// Two-phase preview -> commit, same client shape as useSales.ts's
// previewSalesCsv/commitSalesCsv.

export interface CsvAwardRuleRow {
  rowIndex: number;
  awardCode: string;
  ruleType: string;
  jurisdiction: string | null;
  thresholdValue: number;
  effectiveFrom: string;
  sourceCitation: string | null;
}

export interface CsvImportPreview {
  valid: CsvAwardRuleRow[];
  invalid: Array<{ rowIndex: number; reason: string }>;
}

export interface CsvImportCommitResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

export async function previewAwardRuleCsv(file: File): Promise<CsvImportPreview> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/award-rules/import/preview`, { ...opts, method: "POST", body: form });
  if (!res.ok) throw await parseError(res, "Failed to preview CSV");
  return res.json();
}

export async function commitAwardRuleCsvImport(rows: CsvAwardRuleRow[]): Promise<CsvImportCommitResult> {
  const res = await fetch(`${BASE}/award-rules/import/commit`, {
    ...jsonOpts,
    method: "POST",
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw await parseError(res, "Failed to commit CSV import");
  return res.json();
}

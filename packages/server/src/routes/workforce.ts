/**
 * @module routes/workforce
 *
 * REST endpoints for Workforce Optimisation (Phase 3): demand forecasting
 * (Slice 1), staffing coverage (Slice 2), and shift swap (Slice 3).
 *
 * Gated on the workforce_enabled site_setting (404 when off — see
 * requireFlag's own header comment), then require authentication. Reuses
 * Roster Core's existing permission keys — no new keys minted, matching the
 * established "reuse an existing roster:* key unless there's a real
 * access-control distinction" precedent (e.g. the public-holiday admin
 * loader reusing roster:manage).
 */

import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.js";
import { requireFlag } from "../middleware/requireFlag.js";
import {
  handleGetWorkforceDemand,
  handleGetStaffingCoverage,
  handleOfferSwap,
  handleListOpenSwaps,
  handleClaimSwap,
  handleCancelSwap,
} from "../controllers/workforceController.js";

const router = Router();
// Ahead of authenticate, on purpose — see routes/roster.ts's identical
// comment: with the flag off, an unauthenticated prober should see the same
// 404 an authenticated one gets.
router.use(requireFlag("workforce_enabled"));
router.use(authenticate);

router.get("/demand", requirePermission("roster:read-all"), handleGetWorkforceDemand);
router.get("/coverage", requirePermission("roster:read-all"), handleGetStaffingCoverage);

// Self-service swap marketplace — roster:read-own, same tier MyShiftsView's
// own respond/consent routes use. Browsing briefly surfaces another staff
// member's name + shift time, a deliberate minimal disclosure the feature
// can't function without (Decision 5's own reasoning).
router.post("/swaps", requirePermission("roster:read-own"), handleOfferSwap);
router.get("/swaps", requirePermission("roster:read-own"), handleListOpenSwaps);
router.post("/swaps/:id/claim", requirePermission("roster:read-own"), handleClaimSwap);
router.post("/swaps/:id/cancel", requirePermission("roster:read-own"), handleCancelSwap);

export default router;

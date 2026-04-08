/**
 * @module controllers/storeLocationController
 *
 * Express handlers for store location CRUD, staff assignment,
 * store key management, operating hours, and location context.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  createStoreLocation,
  getStoreLocation,
  getOrgStoreLocations,
  updateStoreLocation,
  deactivateStoreLocation,
  joinStoreLocation,
  regenerateStoreKey,
  assignStaffToLocation,
  removeStaffFromLocation,
  getLocationStaff,
  getLocationHours,
  setLocationHours,
  getLocationPulse,
  getUserStoreLocations,
  hasLocationAccess,
} from "../services/storeLocationService.js";
import {
  getUserLocationContext,
  switchLocation,
  updateModulePreference,
} from "../services/locationContextService.js";
import { getMembership } from "../services/organisationService.js";

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const CLASSIFICATIONS = ["hq", "branch", "commissary", "satellite"] as const;

const CreateLocationSchema = z.object({
  organisationId: z.number().int().positive(),
  locationName: z.string().min(1).max(200),
  classification: z.enum(CLASSIFICATIONS).optional().default("branch"),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  suburb: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  postcode: z.string().max(20).optional(),
  colorAccent: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  photoPath: z.string().max(500).optional(),
});

const UpdateLocationSchema = z.object({
  locationName: z.string().min(1).max(200).optional(),
  classification: z.enum(CLASSIFICATIONS).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  suburb: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  postcode: z.string().max(20).optional(),
  colorAccent: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  photoPath: z.string().max(500).optional(),
});

const JoinStoreSchema = z.object({ storeKey: z.string().min(1) });

const AssignStaffSchema = z.object({ userId: z.number().int().positive() });

const SwitchLocationSchema = z.object({
  storeLocationId: z.string().uuid(),
  moduleKey: z.string().max(50).optional(),
});

const ModulePreferenceSchema = z.object({
  moduleKey: z.string().min(1).max(50),
  storeLocationId: z.string().uuid(),
});

const HourSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openTime: z.string().regex(/^\d{2}:\d{2}$/),
  closeTime: z.string().regex(/^\d{2}:\d{2}$/),
  isClosed: z.boolean().optional(),
});

const SetHoursSchema = z.object({
  hours: z.array(HourSchema).max(7),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Verify requesting user is an org admin for the location's org. */
async function requireOrgAdminForLocation(
  userId: number,
  storeLocationId: string,
  res: Response
): Promise<boolean> {
  const location = await getStoreLocation(storeLocationId);
  if (!location) {
    res.status(404).json({ error: "Store location not found." });
    return false;
  }

  const membership = await getMembership(userId, location.organisationId);
  if (!membership || membership.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Location CRUD
// ---------------------------------------------------------------------------

/** POST /api/store-locations — create a store location. */
export async function handleCreateStoreLocation(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = CreateLocationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const userId = req.user!.sub;
    const { organisationId, ...locationData } = parsed.data;

    // Verify user is org admin
    const membership = await getMembership(userId, organisationId);
    if (!membership || membership.role !== "admin") {
      res.status(403).json({ error: "Admin access required." });
      return;
    }

    const location = await createStoreLocation(
      organisationId,
      locationData,
      userId
    );
    res.status(201).json({ storeLocation: location });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("idx_store_location_hq_unique")) {
      res
        .status(409)
        .json({ error: "An HQ already exists for this organisation." });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/** GET /api/store-locations/mine — get user's assigned locations. */
export async function handleGetMyStoreLocations(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const ctx = await getUserLocationContext(req.user!.sub);
    res.json({
      locations: ctx.locations,
      selectedLocationId: ctx.selectedLocationId,
      isOrgAdmin: ctx.isOrgAdmin,
      hasLocationAccess: ctx.hasLocationAccess,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/store-locations/:id — get a store location. */
export async function handleGetStoreLocation(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const locationId = req.params.id as string;
    const userId = req.user!.sub;

    const access = await hasLocationAccess(userId, locationId);
    if (!access) {
      res.status(403).json({ error: "Not assigned to this location." });
      return;
    }

    const location = await getStoreLocation(locationId);
    if (!location) {
      res.status(404).json({ error: "Store location not found." });
      return;
    }

    res.json({ storeLocation: location });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/store-locations/:id — update a store location (admin). */
export async function handleUpdateStoreLocation(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = UpdateLocationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const locationId = req.params.id as string;
    const isAdmin = await requireOrgAdminForLocation(
      req.user!.sub,
      locationId,
      res
    );
    if (!isAdmin) return;

    const updated = await updateStoreLocation(locationId, parsed.data);
    res.json({ storeLocation: updated });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("idx_store_location_hq_unique")) {
      res
        .status(409)
        .json({ error: "An HQ already exists for this organisation." });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/** POST /api/store-locations/:id/deactivate — deactivate (admin). */
export async function handleDeactivateStoreLocation(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const locationId = req.params.id as string;
    const isAdmin = await requireOrgAdminForLocation(
      req.user!.sub,
      locationId,
      res
    );
    if (!isAdmin) return;

    const updated = await deactivateStoreLocation(locationId);
    res.json({ storeLocation: updated });
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Store Key
// ---------------------------------------------------------------------------

/** POST /api/store-locations/join — join via store key. */
export async function handleJoinStoreLocation(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = JoinStoreSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const location = await joinStoreLocation(
      req.user!.sub,
      parsed.data.storeKey
    );
    res.json({ storeLocation: location });
  } catch (err: unknown) {
    if (err instanceof Error) {
      const msg = err.message;
      if (msg.includes("not found")) {
        res.status(404).json({ error: msg });
      } else if (msg.includes("must be a member")) {
        res.status(403).json({ error: msg });
      } else if (msg.includes("already assigned")) {
        res.status(409).json({ error: msg });
      } else {
        res.status(400).json({ error: msg });
      }
      return;
    }
    next(err);
  }
}

/** POST /api/store-locations/:id/regenerate-key — regenerate store key (admin). */
export async function handleRegenerateStoreKey(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const locationId = req.params.id as string;
    const isAdmin = await requireOrgAdminForLocation(
      req.user!.sub,
      locationId,
      res
    );
    if (!isAdmin) return;

    const newKey = await regenerateStoreKey(locationId);
    res.json({ storeKey: newKey });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Staff Assignment
// ---------------------------------------------------------------------------

/** GET /api/store-locations/:id/staff — list staff at a location. */
export async function handleGetLocationStaff(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const locationId = req.params.id as string;
    const access = await hasLocationAccess(req.user!.sub, locationId);
    if (!access) {
      res.status(403).json({ error: "Not assigned to this location." });
      return;
    }

    const staff = await getLocationStaff(locationId);
    res.json({ staff });
  } catch (err) {
    next(err);
  }
}

/** POST /api/store-locations/:id/staff — assign staff (admin). */
export async function handleAssignStaff(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = AssignStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const locationId = req.params.id as string;
    const isAdmin = await requireOrgAdminForLocation(
      req.user!.sub,
      locationId,
      res
    );
    if (!isAdmin) return;

    const assignment = await assignStaffToLocation(
      locationId,
      parsed.data.userId,
      req.user!.sub
    );
    res.status(201).json({ assignment });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message.includes("already assigned")) {
        res.status(409).json({ error: err.message });
      } else {
        res.status(400).json({ error: err.message });
      }
      return;
    }
    next(err);
  }
}

/** DELETE /api/store-locations/:id/staff/:userId — remove staff (admin). */
export async function handleRemoveStaff(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const locationId = req.params.id as string;
    const targetUserId = parseInt(req.params.userId as string);
    const isAdmin = await requireOrgAdminForLocation(
      req.user!.sub,
      locationId,
      res
    );
    if (!isAdmin) return;

    await removeStaffFromLocation(locationId, targetUserId);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Location Context
// ---------------------------------------------------------------------------

/** GET /api/users/location-context — get location context. */
export async function handleGetLocationContext(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const ctx = await getUserLocationContext(req.user!.sub);
    res.json(ctx);
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/users/selected-location — switch location. */
export async function handleSwitchLocation(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = SwitchLocationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const userId = req.user!.sub;
    const { storeLocationId, moduleKey } = parsed.data;

    // Verify access
    const access = await hasLocationAccess(userId, storeLocationId);
    if (!access) {
      res.status(403).json({ error: "Not assigned to this location." });
      return;
    }

    await switchLocation(userId, storeLocationId, moduleKey);
    res.json({ success: true, selectedLocationId: storeLocationId });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/users/location-preferences — update module preference. */
export async function handleUpdateModulePreference(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = ModulePreferenceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    await updateModulePreference(
      req.user!.sub,
      parsed.data.moduleKey,
      parsed.data.storeLocationId
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Location Pulse
// ---------------------------------------------------------------------------

/** GET /api/store-locations/:id/pulse — lightweight aggregate. */
export async function handleGetLocationPulse(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const locationId = req.params.id as string;
    const access = await hasLocationAccess(req.user!.sub, locationId);
    if (!access) {
      res.status(403).json({ error: "Not assigned to this location." });
      return;
    }

    const pulse = await getLocationPulse(locationId);
    res.json(pulse);
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Operating Hours
// ---------------------------------------------------------------------------

/** GET /api/store-locations/:id/hours — get operating hours. */
export async function handleGetLocationHours(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const locationId = req.params.id as string;
    const access = await hasLocationAccess(req.user!.sub, locationId);
    if (!access) {
      res.status(403).json({ error: "Not assigned to this location." });
      return;
    }

    const hours = await getLocationHours(locationId);
    res.json({ hours });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/store-locations/:id/hours — set operating hours (admin). */
export async function handleSetLocationHours(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const parsed = SetHoursSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const locationId = req.params.id as string;
    const isAdmin = await requireOrgAdminForLocation(
      req.user!.sub,
      locationId,
      res
    );
    if (!isAdmin) return;

    const hours = await setLocationHours(locationId, parsed.data.hours);
    res.json({ hours });
  } catch (err) {
    next(err);
  }
}

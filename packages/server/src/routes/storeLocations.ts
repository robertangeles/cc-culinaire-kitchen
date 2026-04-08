/**
 * @module routes/storeLocations
 *
 * REST endpoints for store location management, staff assignment,
 * store keys, operating hours, and location pulse.
 *
 * All routes require authentication.
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  handleCreateStoreLocation,
  handleGetMyStoreLocations,
  handleGetStoreLocation,
  handleUpdateStoreLocation,
  handleDeactivateStoreLocation,
  handleJoinStoreLocation,
  handleRegenerateStoreKey,
  handleGetLocationStaff,
  handleAssignStaff,
  handleRemoveStaff,
  handleGetLocationPulse,
  handleGetLocationHours,
  handleSetLocationHours,
} from "../controllers/storeLocationController.js";

const router = Router();
router.use(authenticate);

// Collection routes BEFORE parameterized routes (Express lesson)
router.get("/mine", handleGetMyStoreLocations);
router.post("/join", handleJoinStoreLocation);
router.post("/", handleCreateStoreLocation);

// Parameterized routes
router.get("/:id", handleGetStoreLocation);
router.patch("/:id", handleUpdateStoreLocation);
router.post("/:id/deactivate", handleDeactivateStoreLocation);
router.post("/:id/regenerate-key", handleRegenerateStoreKey);

// Staff assignment
router.get("/:id/staff", handleGetLocationStaff);
router.post("/:id/staff", handleAssignStaff);
router.delete("/:id/staff/:userId", handleRemoveStaff);

// Location pulse
router.get("/:id/pulse", handleGetLocationPulse);

// Operating hours
router.get("/:id/hours", handleGetLocationHours);
router.put("/:id/hours", handleSetLocationHours);

export default router;

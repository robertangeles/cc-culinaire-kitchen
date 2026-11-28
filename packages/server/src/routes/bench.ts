/**
 * @module routes/bench
 *
 * REST routes for The Bench community chat.
 * All routes require authentication (no guest access).
 */

import { Router } from "express";
import { authenticate, requirePermission } from "../middleware/auth.js";
import {
  handleGetChannels,
  handleGetMessages,
  handleGetPins,
  handlePinMessage,
  handleUnpinMessage,
  handleSearchMessages,
  handleGetUnreadMentions,
  handleMarkMentionsRead,
  handleGetOrCreateOrgChannel,
  handleUpdateChannelBanner,
  handleGetDmThreads,
  handleGetDmMessages,
  handleCreateDmThread,
} from "../controllers/benchController.js";
import {
  handleListBlocked,
  handleBlock,
  handleUnblock,
  handleReport,
  handleListReports,
  handleReportAction,
} from "../controllers/benchSafetyController.js";

export const benchRouter = Router();

// All bench routes require authentication
benchRouter.use(authenticate);

benchRouter.get("/channels", handleGetChannels);
benchRouter.post("/channels/org", handleGetOrCreateOrgChannel);
benchRouter.get("/channels/:key/messages", handleGetMessages);
benchRouter.get("/channels/:key/pins", handleGetPins);
benchRouter.post("/channels/:key/pins", handlePinMessage);
benchRouter.delete("/pins/:messageId", handleUnpinMessage);
benchRouter.get("/channels/:key/search", handleSearchMessages);
benchRouter.patch("/channels/:key/banner", handleUpdateChannelBanner);
benchRouter.get("/mentions/unread", handleGetUnreadMentions);
benchRouter.post("/mentions/read", handleMarkMentionsRead);

// Direct Messages
benchRouter.get("/dm/threads", handleGetDmThreads);
benchRouter.post("/dm/threads", handleCreateDmThread);
benchRouter.get("/dm/threads/:threadId/messages", handleGetDmMessages);

// Blocking and reporting (every signed-in person)
benchRouter.get("/blocks", handleListBlocked);
benchRouter.post("/blocks", handleBlock);
benchRouter.delete("/blocks/:userId", handleUnblock);
benchRouter.post("/reports", handleReport);

// The moderators' queue
benchRouter.get("/reports", requirePermission("bench:moderate"), handleListReports);
benchRouter.post("/reports/:id/hide", requirePermission("bench:moderate"), handleReportAction("hide"));
benchRouter.post("/reports/:id/dismiss", requirePermission("bench:moderate"), handleReportAction("dismiss"));
benchRouter.post("/reports/:id/resolve", requirePermission("bench:moderate"), handleReportAction("resolve"));

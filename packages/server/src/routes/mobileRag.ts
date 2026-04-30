/**
 * @module routes/mobileRag
 *
 * Express router for the mobile-only RAG retrieval endpoint, mounted at
 * `/api/mobile/rag`.
 *
 * Endpoints:
 *   POST /api/mobile/rag/retrieve — Top-K knowledge chunks for the
 *                                   companion mobile app's on-device LLM
 *                                   grounding flow.
 *
 * Middleware pipeline (applied in order):
 *   1. {@link authenticate} — Requires a valid JWT (web cookie or mobile
 *      Bearer header). No role gate beyond authenticated.
 *   2. {@link mobileRagRateLimit} — 60 req/min/user (or IP for unauth,
 *      though unauth fails step 1 anyway). Higher than the prompt route
 *      because RAG fires on every chat message.
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { mobileRagRateLimit } from "../middleware/rateLimiter.js";
import { handleMobileRagRetrieve } from "../controllers/ragController.js";

export const mobileRagRouter = Router();

mobileRagRouter.post("/retrieve", authenticate, mobileRagRateLimit, handleMobileRagRetrieve);

/**
 * @module controllers/mobileFeedbackController
 *
 * Controller for the mobile in-app feedback endpoint
 * (`POST /api/mobile/feedback`).
 *
 * Pipeline order (set in `routes/mobileFeedback.ts`):
 *   1. {@link mobileVersionGuard}({ enforceMin: true }) — 400/426 on bad header
 *   2. {@link authenticateOptional} — sets `req.user` IF a valid JWT is present
 *   3. {@link feedbackRateLimit} — 10/hr/user (auth) or 3/hr/IP (anon)
 *   4. this controller — zod-validates the body, persists, returns 201
 *
 * The controller is the gatekeeper for the privacy invariants documented
 * on `ckm_feedback` (see schema.ts). In particular: `device_info` is
 * `z.object({...}).strict()` — any new key requires explicit privacy
 * review and a coordinated mobile/server change. Do not relax this to
 * `.passthrough()`; the test in `mobileFeedbackController.test.ts` will
 * fail loudly if you try.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { saveFeedback } from "../services/feedbackService.js";

/**
 * Max length of the base64-encoded screenshot string. Mobile downscales to
 * ≤500 KB *binary* before encoding; base64 inflates by ~33%, so 700 KB
 * of base64 text is a comfortable upper bound (~525 KB binary). The global
 * `express.json({ limit: '10mb' })` is much larger, so this is the
 * authoritative cap for screenshot payload size at the API boundary.
 */
const MAX_SCREENSHOT_BASE64_LEN = 700_000;

/** Closed-shape device_info — `.strict()` rejects any unknown keys. */
const deviceInfoSchema = z
  .object({
    device_model: z.string().min(1).max(200),
    os_name: z.enum(["ios", "android"]),
    os_version: z.string().min(1).max(50),
    locale: z.string().min(2).max(35), // BCP 47, e.g. "en-US"
    app_version: z.string().min(1).max(32),
  })
  .strict();

/** Body schema — `.strict()` rejects unknown top-level keys per the spec. */
const feedbackBodySchema = z
  .object({
    subject: z.string().min(1).max(120),
    body: z.string().min(1).max(4000),
    category: z.enum(["bug", "feature", "feedback"]),
    device_info: deviceInfoSchema.nullable(),
    screenshot_base64: z
      .string()
      .max(MAX_SCREENSHOT_BASE64_LEN)
      .refine((s) => !s.startsWith("data:"), {
        message: "screenshot_base64 must be raw data, no `data:image/...` prefix",
      })
      // Lightweight base64 character check — full decode is overkill and
      // the screenshot is treated as opaque bytes downstream anyway.
      .refine((s) => /^[A-Za-z0-9+/=\r\n]*$/.test(s), {
        message: "screenshot_base64 must be valid base64",
      })
      .nullable(),
  })
  .strict();

/**
 * **POST /api/mobile/feedback** — Submit a feedback / bug / feature row.
 *
 * @returns 201 `{ id: number, created_dttm: string }`
 * @returns 400 on zod validation failure
 * @returns 401 if a Bearer token is present but invalid (handled by `authenticateOptional`)
 * @returns 426 if `X-Mobile-App-Version` < `MIN_MOBILE_APP_VERSION` (handled by `mobileVersionGuard`)
 * @returns 429 if the rate limit is exceeded (with `Retry-After` header)
 */
export async function handlePostMobileFeedback(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = feedbackBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "invalid_body",
    });
    return;
  }

  // The version-guard middleware sets req.mobileAppVersion. Defensive
  // fallback: if somehow undefined (route wired without the guard),
  // 400 rather than persisting a row with missing app_version.
  const appVersion = req.mobileAppVersion;
  if (!appVersion) {
    res.status(400).json({ error: "missing_app_version" });
    return;
  }

  const isAnonymous = !req.user?.sub;
  const userId = req.user?.sub ?? null;

  try {
    const saved = await saveFeedback({
      userId,
      isAnonymous,
      category: parsed.data.category,
      subject: parsed.data.subject,
      body: parsed.data.body,
      appVersion,
      deviceInfo: parsed.data.device_info,
      screenshotBase64: parsed.data.screenshot_base64,
    });
    res.status(201).json({ id: saved.id, created_dttm: saved.createdDttm });
  } catch (err) {
    next(err);
  }
}

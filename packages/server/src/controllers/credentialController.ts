/**
 * @module controllers/credentialController
 *
 * Express request handlers for the encrypted credentials API.
 * All endpoints require Admin role. Delegates to
 * {@link module:credentialService} for encryption and storage.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pino } from "pino";
import {
  listCredentials,
  upsertCredential,
  deleteCredential,
  revealCredential,
  CREDENTIAL_REGISTRY,
  CREDENTIAL_CATEGORIES,
} from "../services/credentialService.js";

const log = pino({ transport: { target: "pino-pretty" } });

/** Zod schema for the upsert request body. */
const UpsertCredentialSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

/**
 * **GET /api/credentials** — List all known credentials with masked values.
 */
export async function handleListCredentials(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const credentials = await listCredentials();
    res.json({ credentials, categories: CREDENTIAL_CATEGORIES });
  } catch (err) {
    log.error(err, "Failed to list credentials");
    next(err);
  }
}

/**
 * **PUT /api/credentials** — Upsert a single credential (encrypted).
 */
export async function handleUpsertCredential(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = UpsertCredentialSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { key, value } = parsed.data;

    if (!CREDENTIAL_REGISTRY[key]) {
      res.status(400).json({ error: `Unknown credential key: ${key}` });
      return;
    }

    const userId = req.user?.sub;
    if (!userId) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }

    await upsertCredential(key, value, userId);

    log.info(
      { action: "credential_upsert", key, userId, ip: req.ip },
      "Credential updated",
    );
    res.json({ success: true });
  } catch (err) {
    log.error(err, "Failed to upsert credential");
    next(err);
  }
}

/**
 * **GET /api/credentials/:key/reveal** — Reveal the full unmasked credential value.
 * Audit-logged for security.
 */
export async function handleRevealCredential(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const key = req.params.key as string;

    if (!CREDENTIAL_REGISTRY[key]) {
      res.status(400).json({ error: `Unknown credential key: ${key}` });
      return;
    }

    const userId = req.user?.sub;
    log.info(
      { action: "credential_reveal", key, userId, ip: req.ip },
      "Credential revealed",
    );

    const value = await revealCredential(key);
    if (value === null) {
      res.status(404).json({ error: "Credential not configured." });
      return;
    }

    res.json({ value });
  } catch (err) {
    log.error(err, "Failed to reveal credential");
    next(err);
  }
}

/**
 * **DELETE /api/credentials/:key** — Remove a credential from DB.
 */
export async function handleDeleteCredential(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const key = req.params.key as string;

    if (!CREDENTIAL_REGISTRY[key]) {
      res.status(400).json({ error: `Unknown credential key: ${key}` });
      return;
    }

    const userId = req.user?.sub;
    await deleteCredential(key);

    log.info(
      { action: "credential_delete", key, userId, ip: req.ip },
      "Credential deleted",
    );
    res.json({ success: true });
  } catch (err) {
    log.error(err, "Failed to delete credential");
    next(err);
  }
}

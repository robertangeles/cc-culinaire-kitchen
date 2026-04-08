/**
 * @module utils/env
 *
 * Centralised environment variable accessors.
 * Every env-dependent default lives here — no more scattered fallbacks.
 */

/** Frontend origin used for CORS, OAuth redirects, email links, etc. */
export const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5179";

/** Backend port */
export const PORT = parseInt(process.env.PORT ?? "3009", 10);

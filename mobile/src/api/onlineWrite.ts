/**
 * Writes that are never queued (roster and compliance changes need a connection): send, then read again. A lost answer, or a refusal that
 * can mean "already done", counts as done only when the fresh copy shows it.
 */

import { ApiError } from "./client";

/** The answer was lost: the server may or may not have done it. */
export const answerLost = (err: unknown) => err instanceof ApiError && (err.code === "network" || err.code === "timeout" || err.code === "server");

/** Neither sent nor refused as far as the phone can tell. */
export class UnsureError extends Error {
  constructor() {
    super("Can't tell whether that went through. Look again with a signal before trying again.");
  }
}

export interface OnlineWrite {
  run: () => Promise<void>;
  /** True when it read what the server holds now. */
  read: () => Promise<boolean>;
  /** Does the fresh copy show it done? */
  landed: () => boolean;
  /** Which refusals can mean it was done already. */
  maybeDone?: (err: ApiError) => boolean;
}

export async function onlineWrite({ run, read, landed, maybeDone = () => false }: OnlineWrite): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (!(err instanceof ApiError) || !(answerLost(err) || maybeDone(err))) throw err;
    const fresh = await read();
    if (fresh && landed()) return;
    if (answerLost(err) && !fresh) throw new UnsureError();
    throw err;
  }
  await read();
}

/** One clear sentence for a write that was refused or lost. `doing` finishes "... needs a connection". */
export function writeMessage(err: unknown, doing: string): string {
  if (err instanceof UnsureError) return err.message;
  if (!(err instanceof ApiError)) return "Something went wrong. Try again.";
  if (err.code === "network" || err.code === "timeout") return `${doing} needs a connection. Try again with a signal.`;
  if (err.code === "rate_limited") return "Too many tries. Wait a minute and try again.";
  if (err.code === "server" || err.code === "bad_response") return "The server had a problem. Try again.";
  return err.message;
}

/** One clear sentence for a list that could not be read. */
export function readMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Try again.";
  return err.code === "network" || err.code === "timeout" ? "Can't reach the server." : err.message;
}

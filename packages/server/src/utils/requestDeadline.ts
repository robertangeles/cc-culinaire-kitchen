/**
 * @module utils/requestDeadline
 *
 * A signal for work that spends money on someone else's behalf (model calls, image generation): it fires
 * when the client hangs up before the answer was sent, or when the time limit passes. Pass it down as
 * `abortSignal`, check it before anything is saved, and the work stops and leaves nothing behind.
 */
import type { Response } from "express";
import { AppError } from "./appError.js";

export interface Deadline {
  signal: AbortSignal;
  /** True once the client closed the connection before the answer finished. */
  readonly clientGone: boolean;
}

export function requestDeadline(res: Response, timeoutMs: number): Deadline {
  const ctl = new AbortController();
  let gone = false;
  const timer = setTimeout(() => ctl.abort(new Error("time limit passed")), timeoutMs);
  timer.unref();
  res.on("close", () => {
    clearTimeout(timer);
    if (!res.writableFinished) {
      gone = true;
      ctl.abort(new Error("client closed the connection"));
    }
  });
  return {
    signal: ctl.signal,
    get clientGone() {
      return gone;
    },
  };
}

/**
 * What to do with an error thrown while a deadline was running: null when nobody is waiting any more
 * (send nothing, charge nothing), a 504 when the time ran out, otherwise the error unchanged.
 */
export function afterDeadline(err: unknown, deadline: Deadline): unknown | null {
  if (deadline.clientGone) return null;
  if (deadline.signal.aborted) return new AppError(504, "AI_TIMEOUT", "That took too long. Please try again.");
  return err;
}

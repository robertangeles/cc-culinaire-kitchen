/**
 * @module services/mfaUsedSteps
 *
 * The last accepted authenticator time step (30 seconds each) per user, so a code is accepted once. Kept in this process's
 * memory: a restart or deploy clears it, and it holds for one server instance (the service runs one).
 */

/** Ten steps is five minutes: far longer than a code is in time, so dropping an older entry lets nothing back in. */
const KEPT_STEPS = 10;

export const lastAcceptedStep = new Map<number, number>();

/**
 * Takes a step for a user: true once, false for that step and every earlier one after that. Synchronous on purpose: two
 * requests with the same code cannot both pass between the check and the write.
 */
export function takeStep(userId: number, step: number): boolean {
  if (step <= (lastAcceptedStep.get(userId) ?? -1)) return false;
  for (const [id, last] of lastAcceptedStep) if (last < step - KEPT_STEPS) lastAcceptedStep.delete(id);
  lastAcceptedStep.set(userId, step);
  return true;
}

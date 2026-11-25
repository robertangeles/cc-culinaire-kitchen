/**
 * @module services/mfaUsedSteps
 *
 * The last accepted authenticator time step (30 seconds each) per user, so a code is accepted once. Kept in this process's
 * memory: a restart or deploy clears it, and it holds for one server instance (the service runs one).
 */

const lastAcceptedStep = new Map<number, number>();

/**
 * Takes a step for a user: true once, false for that step and every earlier one after that. Synchronous on purpose: two
 * requests with the same code cannot both pass between the check and the write.
 */
export function takeStep(userId: number, step: number): boolean {
  if (step <= (lastAcceptedStep.get(userId) ?? -1)) return false;
  lastAcceptedStep.set(userId, step);
  return true;
}

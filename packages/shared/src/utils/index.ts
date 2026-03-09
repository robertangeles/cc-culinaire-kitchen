/**
 * Generate a simple unique ID.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

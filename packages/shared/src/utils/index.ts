/**
 * Generate a simple unique ID.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

export * from "./kitchenProfileConstants.js";
export * from "./units.js";

/**
 * Generate a simple unique ID.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

export * from "./kitchenProfileConstants.js";
export * from "./units.js";
export * from "./packaging.js";
export * from "./unitResolution.js";
export * from "./densities.js";

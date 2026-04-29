import { describe, it, expect } from "vitest";
import {
  PromptIsDeviceOnlyError,
  PromptNotFoundError,
  PromptNotDeviceRuntimeError,
} from "./promptErrors.js";

/**
 * Unit tests for the typed prompt error classes.
 *
 * These errors are the contract between prompt resolution code paths and
 * the central error handler / route handlers. The tests pin down:
 *   1. each class is a real subclass of Error (so `instanceof` works in
 *      both the central error handler and call-site catch arms);
 *   2. each class carries the `promptKey` field that downstream log lines
 *      and HTTP responses include;
 *   3. each `name` field matches the class name (used by structured logs
 *      and serialization).
 *
 * If any of these invariants drift, the runtime guard's behavior would
 * still appear to work (no obvious crash) but the wrong HTTP status code
 * or log signal would surface in production.
 */

describe("PromptIsDeviceOnlyError", () => {
  it("is a real Error subclass with the expected name and key", () => {
    const err = new PromptIsDeviceOnlyError("antoine-system-prompt");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PromptIsDeviceOnlyError);
    expect(err.name).toBe("PromptIsDeviceOnlyError");
    expect(err.promptKey).toBe("antoine-system-prompt");
    expect(err.message).toContain("antoine-system-prompt");
    expect(err.message).toContain("device");
  });

  it("is distinguishable from other prompt errors by instanceof", () => {
    const err = new PromptIsDeviceOnlyError("antoine-system-prompt");
    expect(err).not.toBeInstanceOf(PromptNotFoundError);
    expect(err).not.toBeInstanceOf(PromptNotDeviceRuntimeError);
  });
});

describe("PromptNotFoundError", () => {
  it("is a real Error subclass with the expected name and key", () => {
    const err = new PromptNotFoundError("does-not-exist");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PromptNotFoundError);
    expect(err.name).toBe("PromptNotFoundError");
    expect(err.promptKey).toBe("does-not-exist");
  });
});

describe("PromptNotDeviceRuntimeError", () => {
  it("is a real Error subclass with the expected name and key", () => {
    const err = new PromptNotDeviceRuntimeError("system-prompt");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PromptNotDeviceRuntimeError);
    expect(err.name).toBe("PromptNotDeviceRuntimeError");
    expect(err.promptKey).toBe("system-prompt");
  });

  it("is distinguishable from PromptNotFoundError despite both mapping to 404", () => {
    // The controller maps both errors to a generic 404 to prevent
    // enumeration, but the *log level* differs — PromptNotDeviceRuntimeError
    // is WARN (potential reconnaissance) while PromptNotFoundError is INFO.
    // That distinction depends on instanceof checks staying intact.
    const notDevice = new PromptNotDeviceRuntimeError("system-prompt");
    expect(notDevice).not.toBeInstanceOf(PromptNotFoundError);

    const notFound = new PromptNotFoundError("system-prompt");
    expect(notFound).not.toBeInstanceOf(PromptNotDeviceRuntimeError);
  });
});

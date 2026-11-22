import { describe, it, expect } from "vitest";
import { parseApiErrorBody } from "./apiError.js";

describe("parseApiErrorBody", () => {
  it("reads error and code", () => {
    expect(parseApiErrorBody({ error: "Already done", code: "ALREADY_CONFIRMED" })).toEqual({
      error: "Already done",
      code: "ALREADY_CONFIRMED",
    });
  });

  it("keeps a code it does not know", () => {
    expect(parseApiErrorBody({ error: "x", code: "SOMETHING_NEW" }).code).toBe("SOMETHING_NEW");
  });

  it.each([null, undefined, "<html>502</html>", 42, [], { error: { message: "obj" }, code: 7 }])(
    "does not throw on %j and returns no fields it cannot trust",
    (raw) => {
      expect(parseApiErrorBody(raw)).toEqual({ error: undefined, code: undefined });
    },
  );
});

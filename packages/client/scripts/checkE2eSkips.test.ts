import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no type declarations
import { findUnexpectedSkips, ALLOWED_SKIPS } from "./checkE2eSkips.mjs";

const spec = (file: string, title: string, status: string) => ({ file, title, tests: [{ status }] });

describe("findUnexpectedSkips", () => {
  it("passes when nothing is skipped", () => {
    const report = { suites: [{ specs: [spec("a.spec.ts", "a", "expected")] }] };
    expect(findUnexpectedSkips(report)).toEqual({ unexpected: [], total: 1 });
  });

  it("allows the named deliberate skips", () => {
    const d = ALLOWED_SKIPS[0];
    const report = { suites: [{ specs: [spec(d.file, d.title, "skipped")] }] };
    expect(findUnexpectedSkips(report).unexpected).toEqual([]);
  });

  it("flags any other skip, including nested suites", () => {
    const report = {
      suites: [{ suites: [{ specs: [spec("purchasing.spec.ts", "renders PO list", "skipped")] }] }],
    };
    expect(findUnexpectedSkips(report).unexpected).toEqual(["purchasing.spec.ts > renders PO list"]);
  });

  it("does not let a same-title test in another file ride on the allow list", () => {
    const d = ALLOWED_SKIPS[0];
    const report = { suites: [{ specs: [spec("other.spec.ts", d.title, "skipped")] }] };
    expect(findUnexpectedSkips(report).unexpected).toHaveLength(1);
  });
});

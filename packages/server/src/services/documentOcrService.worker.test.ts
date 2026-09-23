import { describe, it, expect } from "vitest";
import { extractCertificateFields } from "./documentOcrService.js";

/**
 * Deliberately does NOT mock node:worker_threads — the whole point is to
 * spawn the real Worker (documentOcrWorker.ts/.js) and prove it can start.
 *
 * Regression: the worker used to fail to spawn under tsx (dev) because a
 * worker_threads Worker doesn't inherit tsx's module loader the way a plain
 * `import` does — pointing at the (nonexistent, in dev) compiled .js
 * sibling produced a silent 'error' event, never a 'message', which looked
 * identical to a slow OCR call from the caller's side and always ate the
 * full 5s timeout. A trivial 1x1 PNG with no text should resolve in well
 * under that ceiling if the worker actually started; if it silently failed
 * to spawn, this test would time out at ~5s instead.
 * Found by /qa on 2026-09-18. Report: docs/qa/rostering-compliance-test-plan.md (CV-B1)
 */
describe("extractCertificateFields — real worker_threads Worker (no mocks)", () => {
  it("spawns the worker and resolves well under the 5s timeout ceiling", async () => {
    // Smallest possible valid PNG (1x1 transparent pixel) — no text to find,
    // but a real image the worker must actually load to process.
    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );

    const start = Date.now();
    const result = await extractCertificateFields(onePixelPng);
    const elapsed = Date.now() - start;

    expect(result).toEqual({});
    // A hung/never-started worker falls through to the full 5000ms timeout.
    // A real worker processing a 1-pixel image finishes in a few hundred ms.
    expect(elapsed).toBeLessThan(4000);
  }, 10000);
});

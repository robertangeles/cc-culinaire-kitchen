import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the credential lookup so no DB/env is touched.
const mockGetCred = vi.fn();
vi.mock("./credentialService.js", () => ({
  getCredentialValueWithFallback: (key: string) => mockGetCred(key),
}));

import { verifyTurnstileToken } from "./turnstileService.js";

describe("turnstileService.verifyTurnstileToken", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCred.mockResolvedValue("secret-key");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns success when Cloudflare approves the token", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    }) as unknown as typeof fetch;

    const result = await verifyTurnstileToken("good-token", "1.2.3.4");
    expect(result.success).toBe(true);
    expect(result.errorCodes).toEqual([]);
  });

  it("posts secret, response, and remoteip to the siteverify endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await verifyTurnstileToken("tok123", "9.9.9.9");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("siteverify");
    const body = opts.body as URLSearchParams;
    expect(body.get("secret")).toBe("secret-key");
    expect(body.get("response")).toBe("tok123");
    expect(body.get("remoteip")).toBe("9.9.9.9");
  });

  it("omits remoteip from the request when none is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ success: true }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await verifyTurnstileToken("tok-no-ip");

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("response")).toBe("tok-no-ip");
    expect(body.has("remoteip")).toBe(false);
  });

  it("returns failure with Cloudflare error codes when rejected", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
    }) as unknown as typeof fetch;

    const result = await verifyTurnstileToken("bad-token");
    expect(result.success).toBe(false);
    expect(result.errorCodes).toContain("invalid-input-response");
  });

  it("fails closed on a non-OK HTTP status without parsing the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => { throw new Error("should not parse an error page"); },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await verifyTurnstileToken("tok");
    expect(result.success).toBe(false);
    expect(result.errorCodes).toContain("http-503");
  });

  it("fails closed (and never calls Cloudflare) when the secret is not configured", async () => {
    mockGetCred.mockResolvedValue("");
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await verifyTurnstileToken("tok");
    expect(result.success).toBe(false);
    expect(result.errorCodes).toContain("missing-secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on a network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;

    const result = await verifyTurnstileToken("tok");
    expect(result.success).toBe(false);
    expect(result.errorCodes).toContain("network-error");
  });
});

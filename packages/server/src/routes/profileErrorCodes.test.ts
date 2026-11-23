import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { SERVER_ERROR_CODES } from "@culinaire/shared";

// A bearer token here is just the payload as JSON, as in wave6Hardening.integration.test.ts.
vi.mock("../services/authService.js", async (orig) => ({
  ...(await orig<object>()),
  verifyAccessToken: (token: string) => JSON.parse(token),
}));
vi.mock("../services/auditService.js", () => ({ log: vi.fn() }));
const changePassword = vi.fn();
const updateUserProfile = vi.fn();
vi.mock("../services/userService.js", async (orig) => ({
  ...(await orig<object>()),
  changePassword: (...a: unknown[]) => changePassword(...a),
  updateUserProfile: (...a: unknown[]) => updateUserProfile(...a),
}));
const upsertProfile = vi.fn();
vi.mock("../services/userContextService.js", () => ({ getProfile: vi.fn(), upsertProfile: (...a: unknown[]) => upsertProfile(...a) }));
const uploadFileBuffer = vi.fn();
vi.mock("../middleware/upload.js", async (orig) => ({
  ...(await orig<object>()),
  uploadFileBuffer: (...a: unknown[]) => uploadFileBuffer(...a),
}));
vi.mock("../db/index.js", () => ({
  db: { update: () => ({ set: () => ({ where: async () => undefined }) }) },
}));

const { default: usersRouter } = await import("./users.js");
const { errorHandler } = await import("../middleware/errorHandler.js");
const { PasswordChangeError } = await import("../services/userService.js");
const { IMAGE_UPLOAD_MAX_BYTES } = await import("../middleware/upload.js");

/**
 * The phone shows one plain sentence per refusal, chosen by `code`. These are the profile and account
 * routes it calls: every refusal carries a code from the shared list, and `error` and the status stay
 * what the web shows. Through the real router and middleware; services are stubbed.
 */
let server: Server;
const asUser = { authorization: `Bearer ${JSON.stringify({ sub: 5, roles: [], permissions: [] })}` };

beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use("/api/users", usersRouter);
  app.use(errorHandler);
  server = app.listen(0);
});
afterAll(() => server.close());
beforeEach(() => vi.clearAllMocks());

async function call(method: string, path: string, body?: object | FormData, headers: Record<string, string> = asUser) {
  const isForm = body instanceof FormData;
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/users${path}`, {
    method,
    headers: isForm ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const known = (code: unknown) => expect(SERVER_ERROR_CODES).toContain(code);

describe("PATCH /api/users/profile", () => {
  it("answers a bad field 400 VALIDATION, keeping the field errors the web reads", async () => {
    const res = await call("PATCH", "/profile", { userName: "" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
    expect(res.body.error.fieldErrors.userName).toBeDefined();
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it("answers no session 401 UNAUTHENTICATED", async () => {
    const res = await call("PATCH", "/profile", { userName: "x" }, {});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });
});

describe("POST /api/users/change-password", () => {
  const ok = { currentPassword: "old-pass", newPassword: "new-password-1" };

  it("answers a new password under 8 characters 400 WEAK_PASSWORD", async () => {
    const res = await call("POST", "/change-password", { currentPassword: "old-pass", newPassword: "short" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("WEAK_PASSWORD");
    known(res.body.code);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("answers a missing current password 400 VALIDATION", async () => {
    const res = await call("POST", "/change-password", { newPassword: "new-password-1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it.each([
    ["Current password is incorrect.", "INVALID_CREDENTIALS"],
    ["Account uses OAuth login. Set a password via profile settings.", "PASSWORD_NOT_SET"],
    ["User not found.", "NOT_FOUND"],
  ])("answers %s 400 with %s and the same sentence", async (message, code) => {
    changePassword.mockRejectedValue(new PasswordChangeError(message, code as never));
    const res = await call("POST", "/change-password", ok);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message, code });
    known(code);
  });
});

describe("POST /api/users/profile/avatar", () => {
  const form = (bytes: number, type: string) => {
    const f = new FormData();
    f.append("file", new Blob([new Uint8Array(bytes)], { type }), "avatar.jpg");
    return f;
  };

  it("answers a file over the limit 400 FILE_TOO_LARGE, naming the limit the server enforces", async () => {
    expect(IMAGE_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
    const res = await call("POST", "/profile/avatar", form(IMAGE_UPLOAD_MAX_BYTES + 1, "image/jpeg"));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "File too large. Maximum size is 10 MB.", code: "FILE_TOO_LARGE" });
    known(res.body.code);
    expect(uploadFileBuffer).not.toHaveBeenCalled();
  });

  it("answers a file that is not an image 400 UNSUPPORTED_FILE_TYPE", async () => {
    const res = await call("POST", "/profile/avatar", form(10, "application/pdf"));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Only image files (png, jpg, svg, ico, webp) are allowed", code: "UNSUPPORTED_FILE_TYPE" });
    known(res.body.code);
  });

  it("answers an image the photo store cannot read 400 UNSUPPORTED_FILE_TYPE", async () => {
    // Cloudinary rejects a file it cannot read as an image with a plain object, not an Error.
    uploadFileBuffer.mockRejectedValue({ message: "Invalid image file", http_code: 400 });
    const res = await call("POST", "/profile/avatar", form(10, "image/png"));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "That file could not be read as an image.", code: "UNSUPPORTED_FILE_TYPE" });
  });

  it.each([
    ["another 400", { message: "Stale request - reported time is too old", http_code: 400 }],
    ["a refused key", { message: "Invalid api_key 123", http_code: 401 }],
    ["a timeout", { message: "Request Timeout", http_code: 499, name: "TimeoutError" }],
    ["a thrown Error", new Error("ENOSPC: no space left on device")],
  ])("answers %s from the photo store 502 UPLOAD_FAILED without the store's text", async (_name, failure) => {
    uploadFileBuffer.mockRejectedValue(failure);
    const res = await call("POST", "/profile/avatar", form(10, "image/png"));
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "The photo could not be uploaded. Try again.", code: "UPLOAD_FAILED" });
    known(res.body.code);
  });

  it("answers a form with no file 400 VALIDATION", async () => {
    const res = await call("POST", "/profile/avatar", new FormData());
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "No file provided", code: "VALIDATION" });
  });

  it("answers a file under another field name 400 VALIDATION", async () => {
    const f = new FormData();
    f.append("photo", new Blob([new Uint8Array(10)], { type: "image/png" }), "a.png");
    const res = await call("POST", "/profile/avatar", f);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("saves a good image", async () => {
    uploadFileBuffer.mockResolvedValue("/uploads/a.png");
    const res = await call("POST", "/profile/avatar", form(10, "image/png"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ photoPath: "/uploads/a.png" });
  });
});

describe("PUT /api/users/kitchen-profile", () => {
  it("answers bad data 400 VALIDATION, keeping the sentence and the field errors", async () => {
    const res = await call("PUT", "/kitchen-profile", { servingsDefault: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid kitchen profile data.");
    expect(res.body.code).toBe("VALIDATION");
    expect(res.body.details.servingsDefault).toBeDefined();
    expect(upsertProfile).not.toHaveBeenCalled();
  });
});

describe("rate limit on change-password", () => {
  it("answers 429 RATE_LIMITED once the per-address limit is spent", async () => {
    let last = { status: 0, body: {} as Record<string, any> };
    for (let i = 0; i < 25 && last.status !== 429; i++) {
      last = await call("POST", "/change-password", {});
    }
    expect(last.status).toBe(429);
    expect(last.body.code).toBe("RATE_LIMITED");
  });
});

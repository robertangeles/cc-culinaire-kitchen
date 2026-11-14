import { describe, it, expect, vi, beforeEach } from "vitest";

const destroy = vi.hoisted(() => vi.fn());
const creds = vi.hoisted(() => ({ values: {} as Record<string, string | undefined> }));

vi.mock("cloudinary", () => ({ v2: { config: vi.fn(), uploader: { destroy } } }));
vi.mock("../services/credentialService.js", () => ({
  getCredentialValueWithFallback: async (key: string) => creds.values[key],
}));

import { deleteProfilePhoto, profilePhotoPublicId } from "./upload.js";

/**
 * Account deletion removes the avatar file. The URL is user-editable, so this must delete only what
 * the avatar upload itself created and never anything else a user could point their profile at.
 */
const OURS = "https://res.cloudinary.com/demo/image/upload/v1731500000/culinaire/profiles/abc123_XY-z.jpg";

beforeEach(() => {
  destroy.mockReset().mockResolvedValue({ result: "ok" });
  creds.values = { CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" };
});

describe("deleteProfilePhoto", () => {
  it("destroys an avatar we uploaded, by public_id without version or extension", async () => {
    await expect(deleteProfilePhoto(OURS)).resolves.toBe(true);
    expect(destroy).toHaveBeenCalledWith("culinaire/profiles/abc123_XY-z", { resource_type: "image" });
  });

  it("also handles a URL with no version segment", async () => {
    await deleteProfilePhoto("https://res.cloudinary.com/demo/image/upload/culinaire/profiles/p1.png");
    expect(destroy).toHaveBeenCalledWith("culinaire/profiles/p1", { resource_type: "image" });
  });

  it.each([
    ["a Google avatar", "https://lh3.googleusercontent.com/a/abc=s96-c"],
    ["a local dev upload", "/uploads/1731500000-123.jpg"],
    ["another Cloudinary folder (site logo)", "https://res.cloudinary.com/demo/image/upload/v1/culinaire/uploads/logo.png"],
    ["a compliance document", "https://res.cloudinary.com/demo/image/private/v1/culinaire/compliance/org-1/user-2/doc.pdf"],
    ["a path that climbs out of the avatar folder", "https://res.cloudinary.com/demo/image/upload/v1/culinaire/profiles/../uploads/logo.png"],
    ["a query string on an avatar URL", `${OURS}?x=/culinaire/uploads/logo`],
    ["a lookalike host", "https://res.cloudinary.com.evil.test/demo/image/upload/v1/culinaire/profiles/a.jpg"],
    ["a URL on another Cloudinary account with the same public_id", "https://res.cloudinary.com/someone-else/image/upload/v1/culinaire/profiles/abc123_XY-z.jpg"],
    ["plain text", "not a url"],
  ])("leaves %s alone and calls nothing", async (_label, url) => {
    await expect(deleteProfilePhoto(url)).resolves.toBe(false);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("throws, rather than reporting success, when it is our photo but Cloudinary is not configured", async () => {
    creds.values = {};
    await expect(deleteProfilePhoto(OURS)).rejects.toThrow("not configured");
    expect(destroy).not.toHaveBeenCalled();
  });

  it("propagates a Cloudinary failure", async () => {
    destroy.mockRejectedValue(new Error("cloudinary down"));
    await expect(deleteProfilePhoto(OURS)).rejects.toThrow("cloudinary down");
  });
});

describe("profilePhotoPublicId", () => {
  it("is the same for every URL form of one file, so 'same photo?' cannot be dodged by editing the URL", () => {
    const id = "culinaire/profiles/abc123_XY-z";
    expect(profilePhotoPublicId(OURS)).toBe(id);
    expect(profilePhotoPublicId("https://res.cloudinary.com/demo/image/upload/v9/culinaire/profiles/abc123_XY-z.png")).toBe(id);
    expect(profilePhotoPublicId("https://res.cloudinary.com/other/image/upload/culinaire/profiles/abc123_XY-z.webp")).toBe(id);
  });

  it("is null for anything that is not an avatar upload", () => {
    expect(profilePhotoPublicId("https://lh3.googleusercontent.com/a/abc")).toBeNull();
    expect(profilePhotoPublicId("/uploads/1-2.jpg")).toBeNull();
    expect(profilePhotoPublicId("")).toBeNull();
  });
});

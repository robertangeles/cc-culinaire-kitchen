import { describe, it, expect, vi } from "vitest";
import { convertFormDataAsync } from "expo/src/winter/fetch/convertFormData";
import { createAccountApi } from "./account";
import { createComplianceApi } from "../compliance/complianceApi";
import type { ApiClient, TokenStore } from "./client";

/**
 * The phone's global fetch is Expo's, and its own multipart encoder is what an upload goes through. A part it refuses fails as if there were no
 * signal, which no test with a fake client can see: the profile picture was broken on the phone that way.
 */
async function encoded(upload: (client: ApiClient) => Promise<unknown>): Promise<string> {
  let parts: [string, unknown][] = [];
  const request = vi.fn(async () => ({ photoPath: "/x.jpg", storagePublicId: "p", storageFormat: "jpg", ocr: {} }));
  const append = vi.spyOn(FormData.prototype, "append").mockImplementation((...args: unknown[]) => void parts.push([args[0] as string, args[1]]));
  await upload({ request } as unknown as ApiClient);
  append.mockRestore();
  const { body } = await convertFormDataAsync({ entries: () => parts } as unknown as FormData, "B");
  parts = [];
  return String.fromCharCode(...body);
}

const JPEG = new Uint8Array([0xff, 0xd8, 0x41, 0x42]);

describe("photo uploads, through the encoder the phone uses", () => {
  it("sends the profile picture", async () => {
    const body = await encoded((c) => createAccountApi(c, {} as TokenStore).uploadAvatar({ bytes: JPEG, mimeType: "image/jpeg" }));
    expect(body).toContain('name="file"; filename="avatar.jpg"\r\ncontent-type: image/jpeg\r\n\r\n\xff\xd8AB\r\n--B--');
  });

  it("sends a certificate", async () => {
    const body = await encoded((c) => createComplianceApi(c).upload({ bytes: JPEG, mimeType: "image/png" }));
    expect(body).toContain('name="file"; filename="document.png"\r\ncontent-type: image/png\r\n\r\n\xff\xd8AB\r\n--B--');
  });
});

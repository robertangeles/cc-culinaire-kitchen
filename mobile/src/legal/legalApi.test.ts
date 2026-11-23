import { describe, it, expect, vi } from "vitest";
import { createLegalApi } from "./legalApi";
import { ApiError, type ApiClient } from "../api/client";

function setup(reply: unknown) {
  const request = vi.fn(async (_m: string, _p: string, options?: { schema?: { parse(d: unknown): unknown } }) => {
    if (reply instanceof Error) throw reply;
    return options?.schema ? options.schema.parse(reply) : reply;
  });
  return { api: createLegalApi({ request } as unknown as ApiClient), request };
}

describe("loading a legal page", () => {
  it("asks for the phone's own published page, with no sign-in (a person reads the terms before they have an account)", async () => {
    const { api, request } = setup({ title: "Terms of Service", bodyMd: "# Terms\n\nBe kind." });
    expect(await api.load("terms")).toEqual({
      status: "ok",
      title: "Terms of Service",
      blocks: [
        { type: "heading", level: 1, spans: [{ text: "Terms" }] },
        { type: "paragraph", spans: [{ text: "Be kind." }] },
      ],
    });
    expect(request).toHaveBeenCalledWith("GET", "/api/site-pages/terms?surface=mobile", expect.objectContaining({ auth: false }));
  });

  it("is unavailable while the owner has not published it (the server answers 404 for a draft)", async () => {
    expect(await setup(new ApiError("not_found", undefined, 404)).api.load("privacy")).toEqual({ status: "unavailable" });
  });

  it("is unavailable when it is published with no text", async () => {
    expect(await setup({ title: "Privacy Policy", bodyMd: "  \n" }).api.load("privacy")).toEqual({ status: "unavailable" });
  });

  it("says offline when the server cannot be reached, so the screen offers to try again", async () => {
    expect(await setup(new ApiError("network")).api.load("terms")).toEqual({ status: "offline" });
    expect(await setup(new ApiError("timeout")).api.load("terms")).toEqual({ status: "offline" });
  });

  it("is unavailable for any other failure (a server problem is not the person's to fix)", async () => {
    expect(await setup(new ApiError("server", undefined, 500)).api.load("terms")).toEqual({ status: "unavailable" });
  });
});

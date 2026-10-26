import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshUser = vi.fn(async () => {});
vi.mock("../../context/AuthContext.js", () => ({ useAuth: () => ({ refreshUser }) }));

const { MfaSection } = await import("./MfaSection.js");

type Facts = { hasPassword: boolean; mfaEnabledInd: boolean };
type Reply = { ok: boolean; body: unknown };

function mockApi(facts: Facts, replies: { setup?: Reply; disable?: Reply } = {}) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === "/api/users/profile") return { ok: true, json: async () => ({ profile: facts }) };
    if (url === "/api/auth/mfa/setup") {
      const r = replies.setup ?? { ok: true, body: { secret: "ABCD", qrCodeDataUrl: "data:image/png;base64,xx" } };
      return { ok: r.ok, json: async () => r.body };
    }
    if (url === "/api/auth/mfa/disable") {
      const r = replies.disable ?? { ok: true, body: { message: "MFA disabled." } };
      return { ok: r.ok, json: async () => r.body };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const bodyOf = (f: ReturnType<typeof mockApi>, url: string) =>
  JSON.parse(String(f.mock.calls.find((c) => c[0] === url)?.[1]?.body));

afterEach(() => {
  vi.unstubAllGlobals();
  refreshUser.mockClear();
});

describe("MfaSection: starting setup", () => {
  it("password account: asks for the password first and sends it, then shows the QR code", async () => {
    const f = mockApi({ hasPassword: true, mfaEnabledInd: false });
    render(<MfaSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Set Up MFA" }));

    expect(f.mock.calls.some((c) => c[0] === "/api/auth/mfa/setup")).toBe(false);
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByAltText("MFA QR Code")).toBeTruthy();
    expect(bodyOf(f, "/api/auth/mfa/setup")).toEqual({ password: "hunter22" });
  });

  it("shows the server's refusal and no QR code when the password is wrong", async () => {
    mockApi({ hasPassword: true, mfaEnabledInd: false }, { setup: { ok: false, body: { error: "Incorrect password." } } });
    render(<MfaSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Set Up MFA" }));
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Incorrect password.");
    expect(screen.queryByAltText("MFA QR Code")).toBeNull();
  });

  it("Google-only account: no password box, goes straight to the server and shows its message", async () => {
    const f = mockApi(
      { hasPassword: false, mfaEnabledInd: false },
      { setup: { ok: false, body: { error: "For your security, sign out, sign back in, and then change your two-factor settings." } } },
    );
    render(<MfaSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Set Up MFA" }));

    expect((await screen.findByRole("alert")).textContent).toContain("sign out, sign back in");
    expect(screen.queryByLabelText("Your password")).toBeNull();
    expect(bodyOf(f, "/api/auth/mfa/setup")).toEqual({ password: "" });
  });

  it("Cancel closes the password form without calling the server", async () => {
    const f = mockApi({ hasPassword: true, mfaEnabledInd: false });
    render(<MfaSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Set Up MFA" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Set Up MFA" })).toBeTruthy();
    expect(f.mock.calls.some((c) => c[0] === "/api/auth/mfa/setup")).toBe(false);
  });
});

describe("MfaSection: turning MFA off", () => {
  it("asks for the password and an authenticator code, sends both, and refreshes the user", async () => {
    const f = mockApi({ hasPassword: true, mfaEnabledInd: true });
    render(<MfaSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Disable MFA" }));

    const submit = screen.getByRole("button", { name: "Turn off MFA" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "hunter22" } });
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(1));
    expect(bodyOf(f, "/api/auth/mfa/disable")).toEqual({ password: "hunter22", mfaCode: "123456" });
    expect(await screen.findByText("MFA has been disabled.")).toBeTruthy();
  });

  it("Google-only account: asks only for the code", async () => {
    const f = mockApi({ hasPassword: false, mfaEnabledInd: true });
    render(<MfaSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Disable MFA" }));

    expect(screen.queryByLabelText("Your password")).toBeNull();
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn off MFA" }));

    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    expect(bodyOf(f, "/api/auth/mfa/disable")).toEqual({ password: "", mfaCode: "654321" });
  });

  it("keeps MFA on and shows the reason when the server refuses", async () => {
    mockApi(
      { hasPassword: true, mfaEnabledInd: true },
      { disable: { ok: false, body: { error: "That authenticator code is not valid." } } },
    );
    render(<MfaSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Disable MFA" }));
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "hunter22" } });
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn off MFA" }));

    expect((await screen.findByRole("alert")).textContent).toContain("not valid");
    expect(refreshUser).not.toHaveBeenCalled();
    expect(screen.getByText("MFA is currently enabled on your account.")).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const logout = vi.fn(async () => {});
vi.mock("../../context/AuthContext.js", () => ({ useAuth: () => ({ logout }) }));

const { DeleteAccountSection } = await import("./DeleteAccountSection.js");

type Facts = { hasPassword: boolean; mfaEnabledInd: boolean };
const assign = vi.fn();

function mockApi(facts: Facts, deleteResponse: { ok: boolean; body: unknown } = { ok: true, body: { success: true } }) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === "/api/users/profile") {
      return { ok: true, json: async () => ({ profile: { ...facts, userEmail: "chef@example.com" } }) };
    }
    if (url === "/api/users/delete-account") {
      return { ok: deleteResponse.ok, json: async () => deleteResponse.body };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const deleteCall = (f: ReturnType<typeof mockApi>) => f.mock.calls.find((c) => c[0] === "/api/users/delete-account");
const sentBody = (f: ReturnType<typeof mockApi>) => JSON.parse(String(deleteCall(f)?.[1]?.body));

beforeEach(() => {
  logout.mockClear();
  assign.mockClear();
  Object.defineProperty(window, "location", { value: { assign }, writable: true });
});
afterEach(() => vi.unstubAllGlobals());

async function openDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Delete my account" }));
  return screen.findByRole("dialog");
}

describe("DeleteAccountSection", () => {
  it("shows nothing until the account facts load", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<DeleteAccountSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("password account: sends the password, signs out and goes home", async () => {
    const f = mockApi({ hasPassword: true, mfaEnabledInd: false });
    render(<DeleteAccountSection />);
    const dialog = await openDialog();
    expect(screen.queryByLabelText(/authenticator code/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "hunter22" } });
    fireEvent.submit(dialog);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
    expect(sentBody(f)).toEqual({ password: "hunter22" });
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("Google-only account: asks for the email, not a password", async () => {
    const f = mockApi({ hasPassword: false, mfaEnabledInd: false });
    render(<DeleteAccountSection />);
    const dialog = await openDialog();
    expect(screen.queryByLabelText("Your password")).toBeNull();
    fireEvent.change(screen.getByLabelText(/type your email address/i), { target: { value: "chef@example.com" } });
    fireEvent.submit(dialog);
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(sentBody(f)).toEqual({ confirmEmail: "chef@example.com" });
  });

  it("MFA account: also sends the authenticator code", async () => {
    const f = mockApi({ hasPassword: true, mfaEnabledInd: true });
    render(<DeleteAccountSection />);
    const dialog = await openDialog();
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "pw123456" } });
    fireEvent.change(screen.getByLabelText(/authenticator code/i), { target: { value: "123456" } });
    fireEvent.submit(dialog);
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(sentBody(f)).toEqual({ password: "pw123456", mfaCode: "123456" });
  });

  it("shows the server's reason and stays signed in when refused", async () => {
    mockApi({ hasPassword: true, mfaEnabledInd: false }, { ok: false, body: { error: "Incorrect password." } });
    render(<DeleteAccountSection />);
    const dialog = await openDialog();
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "nope" } });
    fireEvent.submit(dialog);
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect password.");
    expect(logout).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("Cancel and Escape close the dialog without calling the server", async () => {
    const f = mockApi({ hasPassword: true, mfaEnabledInd: false });
    render(<DeleteAccountSection />);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await openDialog();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteCall(f)).toBeUndefined();
  });
});

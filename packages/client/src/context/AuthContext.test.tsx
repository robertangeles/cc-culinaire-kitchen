import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext.js";

// Wrapper for hooks that need AuthProvider
function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("AuthContext — defensive JSON parsing", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock the initial /api/auth/me call to return not authenticated
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"Not authenticated"}',
      json: async () => ({ error: "Not authenticated" }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("register handles empty response body without crashing", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    // Wait for initial mount to complete
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Mock fetch for register call — empty body (the bug scenario)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "",
    });

    await expect(
      act(async () => {
        await result.current.register("Bob", "bob@test.com", "Password1");
      }),
    ).rejects.toThrow("Registration failed");
  });

  it("register handles valid JSON error response", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ error: "Email already exists" }),
    });

    await expect(
      act(async () => {
        await result.current.register("Bob", "bob@test.com", "Password1");
      }),
    ).rejects.toThrow("Email already exists");
  });

  it("register returns data on success", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({ message: "Registration successful", userId: 42 }),
    });

    let data: any;
    await act(async () => {
      data = await result.current.register("Bob", "bob@test.com", "Password1");
    });

    expect(data).toEqual(
      expect.objectContaining({ message: "Registration successful" }),
    );
  });

  it("login handles empty response body without crashing", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "",
    });

    await expect(
      act(async () => {
        await result.current.login("bob@test.com", "Password1");
      }),
    ).rejects.toThrow("Login failed");
  });

  it("login handles valid error JSON", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "Invalid credentials" }),
    });

    await expect(
      act(async () => {
        await result.current.login("bob@test.com", "wrong");
      }),
    ).rejects.toThrow("Invalid credentials");
  });
});

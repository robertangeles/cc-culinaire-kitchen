/**
 * The phone's one door to the server. Screens and the outbox call this, never `fetch` (lint rule).
 *
 * - Sends `Authorization: Bearer` and `X-Mobile-App-Version` (the server's version policy reads the header).
 * - A 401 triggers ONE token refresh shared by every request in flight, then one retry. A refresh the
 *   server refuses clears the tokens and fires `onSessionExpired`; a refresh that fails only because the
 *   network is down keeps them. Queued counts are never dropped here: this layer only reports.
 * - Every failure becomes an ApiError whose `code` is what the offline queue branches on.
 */

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/** Where tokens live (the device secure store in the app, memory in tests). */
export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

export type ApiErrorCode =
  | "network"
  | "timeout"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "bad_request"
  | "upgrade_required"
  | "rate_limited"
  | "server";

const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  network: "Can't reach the server. Try again.",
  timeout: "The server took too long. Try again.",
  unauthorized: "Your session has ended. Sign in again.",
  forbidden: "You don't have access to that.",
  not_found: "That wasn't found.",
  conflict: "That conflicts with the current state. Refresh and try again.",
  bad_request: "That wasn't accepted.",
  upgrade_required: "Update the app to continue.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  server: "The server had a problem. Try again.",
};

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message?: string,
    /** HTTP status, 0 when the server was never reached. */
    public readonly status = 0,
    /** Parsed response body when there was one (the 409 `missing` list lives here). */
    public readonly body?: unknown,
  ) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = "ApiError";
  }
}

function codeForStatus(status: number): ApiErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 426) return "upgrade_required";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_request";
}

export interface ApiClientOptions {
  baseUrl: string;
  tokenStore: TokenStore;
  appVersion: string;
  fetchFn?: typeof fetch;
  onSessionExpired?: () => void;
  timeoutMs?: number;
}

export interface RequestOptions {
  body?: unknown;
  /** False for sign-in and MFA: no token is sent and a 401 is a plain wrong-password answer, never a refresh. */
  auth?: boolean;
}

export function createApiClient(opts: ApiClientOptions) {
  const { baseUrl, tokenStore, appVersion, onSessionExpired, timeoutMs = 15000 } = opts;
  const fetchFn = opts.fetchFn ?? fetch;
  let refreshing: Promise<Tokens> | null = null;

  async function send<T>(method: string, path: string, body: unknown, accessToken: string | null): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", "X-Mobile-App-Version": appVersion };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    } catch (err) {
      throw new ApiError(err instanceof Error && err.name === "AbortError" ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (res.ok) return parsed as T;

    const code = codeForStatus(res.status);
    const message = parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string" ? (parsed as { error: string }).error : undefined;
    throw new ApiError(code, message, res.status, parsed);
  }

  function refresh(refreshToken: string): Promise<Tokens> {
    refreshing ??= (async () => {
      try {
        const out = await send<{ tokens: { accessToken: string; refreshToken?: string } }>("POST", "/api/auth/refresh", { refreshToken }, null);
        const tokens = { accessToken: out.tokens.accessToken, refreshToken: out.tokens.refreshToken ?? refreshToken };
        await tokenStore.save(tokens);
        return tokens;
      } catch (err) {
        // Only a refusal ends the session. A dead network or a 5xx says nothing about the token.
        if (err instanceof ApiError && err.code === "unauthorized") {
          await tokenStore.clear();
          onSessionExpired?.();
        }
        throw err;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const { body, auth = true } = options;
    if (!auth) return send<T>(method, path, body, null);

    const tokens = await tokenStore.load();
    if (!tokens) throw new ApiError("unauthorized");
    try {
      return await send<T>(method, path, body, tokens.accessToken);
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== "unauthorized") throw err;
    }

    // Another request may have refreshed while this one was in flight: use its token instead of refreshing again.
    const current = await tokenStore.load();
    if (!current) throw new ApiError("unauthorized");
    const fresh = current.accessToken !== tokens.accessToken ? current : await refresh(current.refreshToken);
    return send<T>(method, path, body, fresh.accessToken);
  }

  return { request };
}

export type ApiClient = ReturnType<typeof createApiClient>;

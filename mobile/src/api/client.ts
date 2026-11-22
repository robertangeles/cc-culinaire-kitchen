/**
 * The phone's one door to the server. Screens and the outbox call this, never `fetch` (lint rule).
 *
 * - Sends `Authorization: Bearer` and `X-Mobile-App-Version` (the server's version policy reads the header).
 * - A 401 triggers ONE token refresh shared by every request in flight, then one retry. A refresh the
 *   server refuses clears the tokens and fires `onSessionExpired`; a refresh that fails only because the
 *   network is down keeps them. Queued counts are never dropped here: this layer only reports.
 * - Every failure becomes an ApiError whose `code` is what the offline queue branches on. When the server
 *   sends its own machine-readable `code` in the body, it is kept as `serverCode`: branch on that, never on
 *   the English `message`.
 * - JSON (`request`), multipart upload (a FormData body), binary download (`download`) and a streamed text
 *   body (`stream`) all share the same auth, refresh and error handling. Each call may set its own timeout
 *   and an AbortSignal.
 */

import { ApiErrorBodySchema, normaliseCode } from "@culinaire/shared/schemas/errors";

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
  | "server"
  /** The server answered, but not in a shape this app version understands. */
  | "bad_response"
  /** The caller's own AbortSignal fired. */
  | "aborted";

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
  bad_response: "The server sent something this app didn't expect. Try again, or update the app.",
  aborted: "Cancelled.",
};

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message?: string,
    /** HTTP status, 0 when the server was never reached. */
    public readonly status = 0,
    /** Parsed response body when there was one (the 409 `missing` list lives here). */
    public readonly body?: unknown,
    /** The `code` the server put in the body, upper-cased, when it sent one. */
    public readonly serverCode?: string,
  ) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = "ApiError";
  }

  /** True when the server sent this machine-readable code (compared case-insensitively). */
  hasCode(code: string): boolean {
    return this.serverCode === normaliseCode(code);
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
  /** A fetch whose response body can be read piece by piece (`expo/fetch` on the phone); the built-in one buffers. Defaults to `fetchFn`. */
  streamFetchFn?: typeof fetch;
  onSessionExpired?: () => void;
  /** Default for JSON calls. */
  timeoutMs?: number;
  /** Default for uploads and downloads, which move more bytes. */
  transferTimeoutMs?: number;
}

export interface RequestOptions<T = unknown> {
  /** JSON-encoded, unless it is a FormData: that is sent as multipart and the runtime sets the boundary. */
  body?: unknown;
  /** False for sign-in and MFA: no token is sent and a 401 is a plain wrong-password answer, never a refresh. */
  auth?: boolean;
  /** This call only. For a stream it limits the wait for the first byte; stop a stream with `signal`. */
  timeoutMs?: number;
  /** Aborts the call: the ApiError has code "aborted". */
  signal?: AbortSignal;
  /** Checks the reply at the boundary (the shared zod schemas); a reply that fails it is "bad_response". */
  schema?: { parse(data: unknown): T };
}

type Mode = "json" | "blob" | "stream";

export function createApiClient(opts: ApiClientOptions) {
  const { baseUrl, tokenStore, appVersion, onSessionExpired, timeoutMs = 15000, transferTimeoutMs = 60000 } = opts;
  const fetchFn = opts.fetchFn ?? fetch;
  const streamFetchFn = opts.streamFetchFn ?? fetchFn;
  let refreshing: Promise<Tokens> | null = null;

  /** One HTTP exchange. `read` turns an ok response into the result inside the timeout; a stream reads later, so it keeps the abort link open until `release`. */
  async function send<T>(mode: Mode, method: string, path: string, options: RequestOptions, accessToken: string | null): Promise<{ value: T; release: () => void }> {
    const { body, signal } = options;
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const headers: Record<string, string> = { Accept: mode === "json" ? "application/json" : "*/*", "X-Mobile-App-Version": appVersion };
    if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    if (signal?.aborted) throw new ApiError("aborted");
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? (mode === "json" && !isForm ? timeoutMs : transferTimeoutMs));
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const release = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    try {
      const res = await (mode === "stream" ? streamFetchFn : fetchFn)(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw failure(res.status, await res.text());
      if (mode === "stream") {
        clearTimeout(timer); // the wait for the first byte is over; the caller's signal ends the stream
        return { value: res as T, release };
      }
      // Read inside the timeout too: a server that sends headers and then stalls must not hang the queue.
      const value = mode === "blob" ? ((await res.blob()) as T) : parseJson<T>(await res.text(), res.status, options);
      release();
      return { value, release };
    } catch (err) {
      release();
      if (err instanceof ApiError) throw err;
      throw new ApiError(timedOut ? "timeout" : signal?.aborted ? "aborted" : "network");
    }
  }

  function parseJson<T>(text: string, status: number, options: RequestOptions): T {
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!options.schema) return parsed as T;
    try {
      return options.schema.parse(parsed) as T;
    } catch {
      throw new ApiError("bad_response", undefined, status, parsed);
    }
  }

  function failure(status: number, text: string): ApiError {
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    const { error, code } = ApiErrorBodySchema.safeParse(parsed).data ?? {};
    return new ApiError(codeForStatus(status), error, status, parsed, code === undefined ? undefined : normaliseCode(code));
  }

  function refresh(refreshToken: string): Promise<Tokens> {
    refreshing ??= (async () => {
      try {
        const { value: out } = await send<{ tokens: { accessToken: string; refreshToken?: string } }>("json", "POST", "/api/auth/refresh", { body: { refreshToken } }, null);
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

  async function execute<T>(mode: Mode, method: string, path: string, options: RequestOptions): Promise<{ value: T; release: () => void }> {
    if (options.auth === false) return send<T>(mode, method, path, options, null);

    const tokens = await tokenStore.load();
    if (!tokens) throw new ApiError("unauthorized");
    try {
      return await send<T>(mode, method, path, options, tokens.accessToken);
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== "unauthorized") throw err;
    }

    // Another request may have refreshed while this one was in flight: use its token instead of refreshing again.
    const current = await tokenStore.load();
    if (!current) throw new ApiError("unauthorized");
    const fresh = current.accessToken !== tokens.accessToken ? current : await refresh(current.refreshToken);
    return send<T>(mode, method, path, options, fresh.accessToken);
  }

  /** JSON in, JSON out. A FormData body uploads as multipart. */
  async function request<T = unknown>(method: string, path: string, options: RequestOptions<T> = {}): Promise<T> {
    return (await execute<T>("json", method, path, options)).value;
  }

  /** The response body as a Blob (a PDF, an image). */
  async function download(path: string, options: RequestOptions = {}): Promise<Blob> {
    return (await execute<Blob>("blob", options.body === undefined ? "GET" : "POST", path, options)).value;
  }

  /**
   * The response body as it arrives, as text pieces (the chat answer). Ends when the server closes it; stop early with
   * `options.signal`. A failure after the first byte throws an ApiError ("network", or "aborted" for the caller's own signal).
   */
  async function* stream(method: string, path: string, options: RequestOptions = {}): AsyncGenerator<string> {
    const { value: res, release } = await execute<Response>("stream", method, path, options);
    try {
      if (!res.body) throw new ApiError("bad_response", undefined, res.status);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          yield decoder.decode(value, { stream: true });
        }
        const rest = decoder.decode();
        if (rest) yield rest;
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError(options.signal?.aborted ? "aborted" : "network");
      } finally {
        void reader.cancel().catch(() => undefined);
      }
    } finally {
      release();
    }
  }

  return { request, download, stream };
}

export type ApiClient = ReturnType<typeof createApiClient>;

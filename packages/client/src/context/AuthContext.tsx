/**
 * @module context/AuthContext
 *
 * Provides authentication state to the React component tree.
 * Supports both authenticated users (JWT) and anonymous guest sessions.
 * On mount, checks for an existing session via GET /api/auth/me.
 * Automatically refreshes the access token every 14 minutes.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

/** Shape of the authenticated user returned by the API. */
export interface AuthUser {
  userId: number;
  userName: string;
  userEmail: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  userPhotoPath: string | null;
  freeSessions: number;
  subscriptionStatus: string;
  subscriptionTier: string;
  userStatus: string;
  roles: string[];
  permissions: string[];
}

/** Result of login: either success or MFA challenge. */
export type LoginResult =
  | { requiresMfa: false }
  | { requiresMfa: true; mfaSessionToken: string };

/** Guest session usage info. */
export interface GuestUsage {
  sessionsUsed: number;
  sessionsLimit: number;
  sessionsRemaining: number;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** True when using a guest session (no login). */
  isGuest: boolean;
  /** Guest session token (stored in localStorage). */
  guestToken: string | null;
  /** Guest usage info (sessions used/remaining). */
  guestUsage: GuestUsage | null;
  /** True when the server rejected guest session creation (IP limit). */
  guestLimitReached: boolean;
  /** Initialize a guest session (called from login page). */
  initGuest: () => Promise<void>;
  /** Refresh guest usage info. */
  refreshGuestUsage: () => Promise<void>;
  login: (email: string, password: string) => Promise<LoginResult>;
  completeMfaLogin: (mfaSessionToken: string, code: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<{ message: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>(null as unknown as AuthContextValue);

const REFRESH_INTERVAL = 50 * 60 * 1000; // 50 minutes (10-min buffer before 1-hour token expiry)
const GUEST_TOKEN_KEY = "culinaire_guest_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [guestUsage, setGuestUsage] = useState<GuestUsage | null>(null);
  const [guestLimitReached, setGuestLimitReached] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshTime = useRef<number>(0);

  /** Fetches current user from the session cookie.
   *  Returns null on definitive 401 (not authenticated).
   *  Returns undefined on network errors or server errors (caller should preserve existing state). */
  const fetchMe = useCallback(async (): Promise<AuthUser | null | undefined> => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.status === 401) return null;  // definitive "not authenticated"
      if (!res.ok) return undefined;         // server error — keep existing state
      const data = await res.json();
      return data.user;
    } catch {
      return undefined; // network error — keep existing state
    }
  }, []);

  /** Refreshes the access token using the refresh token cookie.
   *  NEVER calls setUser(null) — only explicit logout can do that.
   *  On failure, silently retries in 30s. If session is truly expired,
   *  API calls will return 401 errors in the UI and user re-logins manually. */
  const refreshToken = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        lastRefreshTime.current = Date.now();
        return;
      }
      // Any non-ok response (401, 500, etc.) — schedule retry, never logout
    } catch {
      // Network error — schedule retry, never logout
    }
    // Schedule a retry in 30s for transient failures
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      refreshToken();
    }, 30_000);
  }, []);

  /** Starts automatic token refresh interval. */
  const startRefreshLoop = useCallback(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(refreshToken, REFRESH_INTERVAL);
  }, [refreshToken]);

  /** Stops automatic token refresh. */
  const stopRefreshLoop = useCallback(() => {
    if (refreshTimer.current) {
      clearInterval(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  /** Fetch guest usage info from server. */
  const refreshGuestUsage = useCallback(async () => {
    const token = guestToken ?? localStorage.getItem(GUEST_TOKEN_KEY);
    if (!token) return;

    try {
      const res = await fetch("/api/guest/session", {
        headers: { "X-Guest-Token": token },
      });
      if (res.ok) {
        const data = await res.json();
        setGuestUsage(data);
      }
    } catch {
      // Silently fail
    }
  }, [guestToken]);

  /** Initialize a new guest session or restore existing one. */
  const initGuest = useCallback(async () => {
    // Check for existing guest token
    const existing = localStorage.getItem(GUEST_TOKEN_KEY);
    if (existing) {
      // Validate the existing session
      try {
        const res = await fetch("/api/guest/session", {
          headers: { "X-Guest-Token": existing },
        });
        if (res.ok) {
          const data = await res.json();
          setGuestToken(existing);
          setGuestUsage(data);
          return;
        }
      } catch {
        // Session invalid, create new one
      }
    }

    // Create a new guest session (server generates the token)
    try {
      const res = await fetch("/api/guest/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem(GUEST_TOKEN_KEY, data.sessionToken);
        setGuestToken(data.sessionToken);
        setGuestUsage({
          sessionsUsed: data.sessionsUsed ?? 0,
          sessionsLimit: data.sessionsLimit ?? 10,
          sessionsRemaining: data.sessionsRemaining ?? 10,
        });
      } else {
        setGuestLimitReached(true);
      }
    } catch {
      setGuestLimitReached(true);
    }
  }, []);

  // Check session on mount
  useEffect(() => {
    (async () => {
      const me = await fetchMe();
      // me === null  → definitive 401 (not authenticated)
      // me === undefined → network/server error (keep existing state, don't logout)
      // me === AuthUser  → authenticated

      if (me !== undefined) {
        setUser(me ?? null);

        if (me) {
          startRefreshLoop();
          lastRefreshTime.current = Date.now();
          // Clear guest token if user is logged in
          localStorage.removeItem(GUEST_TOKEN_KEY);
          setGuestToken(null);
          setGuestUsage(null);
        } else {
          // me is definitively null — confirmed not authenticated
          // Restore existing guest session if token is in localStorage
          const existingToken = localStorage.getItem(GUEST_TOKEN_KEY);
          if (existingToken) {
            try {
              const res = await fetch("/api/guest/session", {
                headers: { "X-Guest-Token": existingToken },
              });
              if (res.ok) {
                const data = await res.json();
                setGuestToken(existingToken);
                setGuestUsage(data);
              } else {
                localStorage.removeItem(GUEST_TOKEN_KEY);
              }
            } catch {
              // Silently fail
            }
          }
          // If no token exists, ProtectedRoute will call initGuest()
        }
      }
      // If me === undefined (network/server error on mount), preserve existing state.
      // isLoading still resolves so the UI doesn't spin forever.

      setIsLoading(false);
    })();

    // Refresh token when the tab becomes visible again — but only if enough time has
    // passed since the last refresh. Browsers throttle setInterval in background tabs
    // (Chrome/Firefox ≥ 1 min), so the 12-min refresh can fire late and the 15-min
    // token may have expired. We skip the refresh if we know it ran recently to avoid
    // unnecessary /api/auth/refresh calls (which risk transient 401s causing logout).
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const tenMinutes = 10 * 60 * 1000;
        if (Date.now() - lastRefreshTime.current > tenMinutes) {
          refreshToken();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopRefreshLoop();
      if (retryTimer.current) clearTimeout(retryTimer.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchMe, startRefreshLoop, stopRefreshLoop, refreshToken]);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      let res: Response;
      try {
        res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email, password }),
        });
      } catch {
        throw new Error("Cannot reach the server. Is the backend running?");
      }

      const text = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`Server error (${res.status}). Please try again later.`);
      }

      if (!res.ok) {
        throw new Error(
          (typeof data.error === "string" ? data.error : null) ??
            `Login failed (${res.status}). Please try again.`,
        );
      }

      if (data.requiresMfa) {
        return { requiresMfa: true, mfaSessionToken: data.mfaSessionToken as string };
      }

      setUser(data.user as AuthUser);
      // Clear guest state on login
      localStorage.removeItem(GUEST_TOKEN_KEY);
      setGuestToken(null);
      setGuestUsage(null);
      lastRefreshTime.current = Date.now();
      startRefreshLoop();
      return { requiresMfa: false };
    },
    [startRefreshLoop],
  );

  const completeMfaLoginFn = useCallback(
    async (mfaSessionToken: string, code: string) => {
      let res: Response;
      try {
        res = await fetch("/api/auth/mfa/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ mfaSessionToken, code }),
        });
      } catch {
        throw new Error("Cannot reach the server. Is the backend running?");
      }

      const text = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`Server error (${res.status}). Please try again later.`);
      }

      if (!res.ok) {
        throw new Error(
          (typeof data.error === "string" ? data.error : null) ??
            `MFA verification failed (${res.status}). Please try again.`,
        );
      }

      setUser(data.user as AuthUser);
      localStorage.removeItem(GUEST_TOKEN_KEY);
      setGuestToken(null);
      setGuestUsage(null);
      lastRefreshTime.current = Date.now();
      startRefreshLoop();
    },
    [startRefreshLoop],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      // Include guest token for conversation linking
      const currentGuestToken = localStorage.getItem(GUEST_TOKEN_KEY);

      let res: Response;
      try {
        res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name,
            email,
            password,
            ...(currentGuestToken ? { guestToken: currentGuestToken } : {}),
          }),
        });
      } catch {
        throw new Error("Cannot reach the server. Is the backend running?");
      }

      const text = await res.text();
      let data: Record<string, unknown> = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`Server error (${res.status}). Please try again later.`);
      }

      if (!res.ok) {
        throw new Error(
          (typeof data.error === "string" ? data.error : null) ??
            `Registration failed (${res.status}). Please try again.`,
        );
      }

      // Clear guest state after successful registration
      localStorage.removeItem(GUEST_TOKEN_KEY);
      setGuestToken(null);
      setGuestUsage(null);

      return data as { message: string; autoVerified?: boolean };
    },
    [],
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
    stopRefreshLoop();
    // Clear recipe session data to prevent data leaking between accounts
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith("recipe_lab_")) sessionStorage.removeItem(key);
    }
  }, [stopRefreshLoop]);

  /** Refreshes user data from the server.
   *  NEVER calls setUser(null) — only explicit logout can do that.
   *  On 401, attempts a token refresh. On failure, keeps existing state. */
  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        return;
      }
      if (res.status === 401) {
        // Access token may have expired — try refreshing
        try {
          const refreshRes = await fetch("/api/auth/refresh", {
            method: "POST",
            credentials: "include",
          });
          if (refreshRes.ok) {
            const data = await refreshRes.json();
            setUser(data.user);
            lastRefreshTime.current = Date.now();
          }
        } catch {
          // Can't reach server — keep existing state
        }
      }
      // Any other error — keep existing state, never logout
    } catch {
      // Network error — keep existing state
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: user !== null,
        isGuest: guestToken !== null && user === null,
        guestToken,
        guestUsage,
        guestLimitReached,
        initGuest,
        refreshGuestUsage,
        login,
        completeMfaLogin: completeMfaLoginFn,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

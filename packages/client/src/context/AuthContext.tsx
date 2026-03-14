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

const REFRESH_INTERVAL = 12 * 60 * 1000; // 12 minutes (3-min buffer before 15-min token expiry)
const GUEST_TOKEN_KEY = "culinaire_guest_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [guestUsage, setGuestUsage] = useState<GuestUsage | null>(null);
  const [guestLimitReached, setGuestLimitReached] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Fetches current user from the session cookie. */
  const fetchMe = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) return null;
      const data = await res.json();
      return data.user;
    } catch {
      return null;
    }
  }, []);

  /** Refreshes the access token using the refresh token cookie.
   *  Retries once on transient failures. Only hard-logouts on explicit 401. */
  const refreshToken = useCallback(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          return;
        }
        if (res.status === 401) {
          // Refresh token is truly expired/invalid — logout
          setUser(null);
          if (refreshTimer.current) {
            clearInterval(refreshTimer.current);
            refreshTimer.current = null;
          }
          return;
        }
        // Other server error (500, 503, etc.) — retry
      } catch {
        // Network error — retry once, then leave user state unchanged
        if (attempt === 1) return;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
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
      setUser(me);

      if (me) {
        startRefreshLoop();
        // Clear guest token if user is logged in
        localStorage.removeItem(GUEST_TOKEN_KEY);
        setGuestToken(null);
        setGuestUsage(null);
      } else {
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

      setIsLoading(false);
    })();

    // Refresh token immediately when the tab becomes visible again.
    // Browsers throttle setInterval in background tabs (Chrome/Firefox ≥ 1 min),
    // so the 12-min refresh can fire late and the 15-min token may have expired.
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshToken();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopRefreshLoop();
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
  }, [stopRefreshLoop]);

  const refreshUser = useCallback(async () => {
    const me = await fetchMe();
    setUser(me);
  }, [fetchMe]);

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

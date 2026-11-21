import type { ApiClient, TokenStore, Tokens } from "./client";

/** What `/auth/login` and `/auth/me` return for a person (only the fields the phone reads). */
export interface AuthUser {
  userId: number;
  userName: string;
  userEmail: string;
  mfaEnabled: boolean;
  roles: string[];
  permissions: string[];
}

export interface StoreLocation {
  storeLocationId: string;
  organisationId: number;
  locationName: string;
  classification: string;
}

export interface LocationContext {
  locations: StoreLocation[];
  selectedLocationId: string | null;
  organisationId: number | null;
  isOrgAdmin: boolean;
  hasLocationAccess: boolean;
}

export type SignInResult = { status: "signedIn"; user: AuthUser } | { status: "mfa"; mfaSessionToken: string };

interface LoginReply {
  user?: AuthUser;
  tokens?: Tokens;
  requiresMfa?: boolean;
  mfaSessionToken?: string;
}

/** Sign-in, session and location calls. Tokens are saved here the moment the server hands them out. */
export function createAuthApi(client: ApiClient, tokenStore: TokenStore) {
  async function finish(reply: LoginReply): Promise<AuthUser> {
    await tokenStore.save({ accessToken: reply.tokens!.accessToken, refreshToken: reply.tokens!.refreshToken });
    return reply.user!;
  }

  async function result(reply: LoginReply): Promise<SignInResult> {
    if (reply.requiresMfa) return { status: "mfa", mfaSessionToken: reply.mfaSessionToken! };
    return { status: "signedIn", user: await finish(reply) };
  }

  return {
    async signIn(email: string, password: string): Promise<SignInResult> {
      return result(await client.request<LoginReply>("POST", "/api/auth/login", { body: { email, password }, auth: false }));
    },

    /** The ID token comes from the phone's Google account picker; the server checks it with Google and answers like a password sign-in. */
    async googleSignIn(idToken: string): Promise<SignInResult> {
      return result(await client.request<LoginReply>("POST", "/api/auth/google/idtoken", { body: { idToken }, auth: false }));
    },

    /** Creates the account only: nobody is signed in, and the person finishes verifying from the email the server sends. */
    async register(name: string, email: string, password: string): Promise<{ autoVerified: boolean }> {
      const reply = await client.request<{ autoVerified?: boolean }>("POST", "/api/auth/register", { body: { name, email, password }, auth: false });
      return { autoVerified: reply.autoVerified === true };
    },

    /** The server answers the same whether or not the address has an account, so neither do we. */
    async forgotPassword(email: string): Promise<void> {
      await client.request("POST", "/api/auth/forgot-password", { body: { email }, auth: false });
    },

    async resendVerification(email: string): Promise<void> {
      await client.request("POST", "/api/auth/resend-verification", { body: { email }, auth: false });
    },

    async verifyMfa(mfaSessionToken: string, code: string): Promise<AuthUser> {
      return finish(await client.request<LoginReply>("POST", "/api/auth/mfa/verify", { body: { mfaSessionToken, code }, auth: false }));
    },

    async me(): Promise<AuthUser> {
      return (await client.request<{ user: AuthUser }>("GET", "/api/auth/me")).user;
    },

    /** Revoke the refresh token on the server if we can; the device tokens go either way. */
    async signOut(): Promise<void> {
      const tokens = await tokenStore.load();
      try {
        if (tokens) await client.request("POST", "/api/auth/logout", { body: { refreshToken: tokens.refreshToken }, auth: false });
      } catch {
        // Offline sign-out still ends the session on this phone; the refresh token expires on its own.
      } finally {
        await tokenStore.clear();
      }
    },

    locationContext(): Promise<LocationContext> {
      return client.request<LocationContext>("GET", "/api/users/location-context");
    },

    selectLocation(storeLocationId: string): Promise<void> {
      return client.request("PATCH", "/api/users/selected-location", { body: { storeLocationId } });
    },
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;

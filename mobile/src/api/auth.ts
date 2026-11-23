import { ApiError, type ApiClient, type TokenStore } from "./client";
import { LocationContextSchema, LoginReplySchema, MeReplySchema, RegisterReplySchema, type AuthUser, type LocationContext, type LoginReply, type StoreLocation } from "@culinaire/shared/schemas/auth";

export type { AuthUser, LocationContext, StoreLocation };

/** What the server needs to check an Apple sign-in (POST /api/auth/apple/idtoken). */
export interface AppleCredential {
  identityToken: string;
  /** The random value whose SHA-256 went to Apple; the server hashes it and compares with the token's nonce. */
  nonce: string;
  authorizationCode?: string;
  /** Apple gives the name once, on the very first authorization, and never again: send it now or lose it. */
  givenName?: string;
  familyName?: string;
}

export type SignInResult = { status: "signedIn"; user: AuthUser } | { status: "mfa"; mfaSessionToken: string };

/** Sign-in, session and location calls. Tokens are saved here the moment the server hands them out. */
export function createAuthApi(client: ApiClient, tokenStore: TokenStore) {
  async function finish(reply: LoginReply): Promise<AuthUser> {
    if (!reply.tokens || !reply.user) throw new ApiError("bad_response");
    await tokenStore.save(reply.tokens);
    return reply.user;
  }

  async function result(reply: LoginReply): Promise<SignInResult> {
    if (reply.requiresMfa) {
      if (!reply.mfaSessionToken) throw new ApiError("bad_response");
      return { status: "mfa", mfaSessionToken: reply.mfaSessionToken };
    }
    return { status: "signedIn", user: await finish(reply) };
  }

  return {
    async signIn(email: string, password: string): Promise<SignInResult> {
      return result(await client.request("POST", "/api/auth/login", { body: { email, password }, auth: false, schema: LoginReplySchema }));
    },

    /** The ID token comes from the phone's Google account picker; the server checks it with Google and answers like a password sign-in. */
    async googleSignIn(idToken: string): Promise<SignInResult> {
      return result(await client.request("POST", "/api/auth/google/idtoken", { body: { idToken }, auth: false, schema: LoginReplySchema }));
    },

    /** The credential comes from Apple's sign-in sheet; the server checks the token with Apple's keys and answers like a password sign-in. */
    async appleSignIn(credential: AppleCredential): Promise<SignInResult> {
      return result(await client.request("POST", "/api/auth/apple/idtoken", { body: credential, auth: false, schema: LoginReplySchema }));
    },

    /** Creates the account only: nobody is signed in, and the person finishes verifying from the email the server sends. */
    async register(name: string, email: string, password: string): Promise<{ autoVerified: boolean }> {
      const reply = await client.request("POST", "/api/auth/register", { body: { name, email, password }, auth: false, schema: RegisterReplySchema });
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
      return finish(await client.request("POST", "/api/auth/mfa/verify", { body: { mfaSessionToken, code }, auth: false, schema: LoginReplySchema }));
    },

    async me(): Promise<AuthUser> {
      return (await client.request("GET", "/api/auth/me", { schema: MeReplySchema })).user;
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
      return client.request("GET", "/api/users/location-context", { schema: LocationContextSchema });
    },

    selectLocation(storeLocationId: string): Promise<void> {
      return client.request("PATCH", "/api/users/selected-location", { body: { storeLocationId } });
    },

    /** First run: join the organisation whose manager gave this key. */
    async joinOrganisation(joinKey: string): Promise<void> {
      await client.request("POST", "/api/organisations/join", { body: { joinKey } });
    },

    /** First run: join a location of an organisation the person is already in. */
    async joinLocation(storeKey: string): Promise<void> {
      await client.request("POST", "/api/store-locations/join", { body: { storeKey } });
    },
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;

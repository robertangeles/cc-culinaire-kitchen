import { ProfileFactsReplySchema } from "@culinaire/shared/schemas/account";
import { ApiError, type ApiClient, type TokenStore } from "./client";

export interface AccountFacts {
  hasPassword: boolean;
  /** Linked to Sign in with Apple: with no password, deletion is confirmed by a fresh Apple sign-in instead of the typed email. */
  hasApple: boolean;
  mfaEnabled: boolean;
  email: string;
}

/** A fresh Sign in with Apple: the identity token and the raw nonce whose SHA-256 went to Apple. */
export interface AppleProof {
  identityToken: string;
  nonce: string;
}

/** The proof the server wants: the password; or for an account with none, a fresh Apple sign-in (Apple) or the email typed back (Google); plus a code when MFA is on. */
export interface DeleteProof {
  password?: string;
  confirmEmail?: string;
  apple?: AppleProof;
  mfaCode?: string;
}

/** Calls behind the account screens. */
export function createAccountApi(client: ApiClient, tokenStore: TokenStore) {
  return {
    async facts(): Promise<AccountFacts> {
      const { profile } = await client.request("GET", "/api/users/profile", { schema: ProfileFactsReplySchema });
      return { hasPassword: profile.hasPassword, hasApple: profile.hasApple, mfaEnabled: profile.mfaEnabledInd, email: profile.userEmail };
    },

    /**
     * Deletes the signed-in person's own account. The refresh token goes in the body because the server finds when this
     * sign-in began from it (the web sends the cookie), and an account with no password must have signed in within 10 minutes.
     */
    async deleteAccount(proof: DeleteProof): Promise<void> {
      const tokens = await tokenStore.load();
      const { apple, ...rest } = proof;
      const body = { ...rest, ...(apple && { appleIdentityToken: apple.identityToken, appleNonce: apple.nonce }), refreshToken: tokens?.refreshToken };
      await client.request("POST", "/api/users/delete-account", { body });
    },
  };
}

export type AccountApi = ReturnType<typeof createAccountApi>;

export interface DeleteFailure {
  text: string;
  /** The server wants an authenticator code, whatever the profile said. */
  needsMfa?: true;
  /** Only signing in again will do. */
  needsFreshSignIn?: true;
}

/** One plain sentence for a refused or failed delete, chosen by the server's code. */
export function deleteAccountMessage(err: unknown, proof: "password" | "email" | "apple"): DeleteFailure {
  if (!(err instanceof ApiError)) return { text: "Couldn't delete the account. Try again." };
  if (err.hasCode("INVALID_CREDENTIALS")) {
    return { text: proof === "password" ? "That password isn't right." : proof === "apple" ? "That Apple sign-in doesn't match this account." : "That email doesn't match your account." };
  }
  if (err.hasCode("MFA_REQUIRED")) return { text: "Enter your authenticator code.", needsMfa: true };
  if (err.hasCode("INVALID_MFA_CODE")) return { text: "That authenticator code isn't valid." };
  if (err.hasCode("RECENT_SIGN_IN_REQUIRED")) return { text: "For your security, sign out, sign back in, then delete your account.", needsFreshSignIn: true };
  // The blocked-by-ownership answers say which organisation and what to do first, so the server's sentence is the useful one.
  return { text: err.message };
}

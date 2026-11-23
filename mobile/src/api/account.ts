import { ProfileFactsReplySchema } from "@culinaire/shared/schemas/account";
import { ApiError, type ApiClient, type TokenStore } from "./client";

export interface AccountFacts {
  hasPassword: boolean;
  mfaEnabled: boolean;
  email: string;
}

/** The proof the server wants: the password, or for an account with none (Google) the email typed back; plus a code when MFA is on. */
export interface DeleteProof {
  password?: string;
  confirmEmail?: string;
  mfaCode?: string;
}

/** Calls behind the account screens. */
export function createAccountApi(client: ApiClient, tokenStore: TokenStore) {
  return {
    async facts(): Promise<AccountFacts> {
      const { profile } = await client.request("GET", "/api/users/profile", { schema: ProfileFactsReplySchema });
      return { hasPassword: profile.hasPassword, mfaEnabled: profile.mfaEnabledInd, email: profile.userEmail };
    },

    /**
     * Deletes the signed-in person's own account. The refresh token goes in the body because the server finds when this
     * sign-in began from it (the web sends the cookie), and an account with no password must have signed in within 10 minutes.
     */
    async deleteAccount(proof: DeleteProof): Promise<void> {
      const tokens = await tokenStore.load();
      await client.request("POST", "/api/users/delete-account", { body: { ...proof, refreshToken: tokens?.refreshToken } });
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
export function deleteAccountMessage(err: unknown, hasPassword: boolean): DeleteFailure {
  if (!(err instanceof ApiError)) return { text: "Couldn't delete the account. Try again." };
  if (err.hasCode("INVALID_CREDENTIALS")) return { text: hasPassword ? "That password isn't right." : "That email doesn't match your account." };
  if (err.hasCode("MFA_REQUIRED")) return { text: "Enter your authenticator code.", needsMfa: true };
  if (err.hasCode("INVALID_MFA_CODE")) return { text: "That authenticator code isn't valid." };
  if (err.hasCode("RECENT_SIGN_IN_REQUIRED")) return { text: "For your security, sign out, sign back in, then delete your account.", needsFreshSignIn: true };
  // The blocked-by-ownership answers say which organisation and what to do first, so the server's sentence is the useful one.
  return { text: err.message };
}

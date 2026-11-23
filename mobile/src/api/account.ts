import {
  AvatarReplySchema,
  KitchenProfileSchema,
  MfaSetupReplySchema,
  PersonalisationOptionsSchema,
  ProfileDetailsReplySchema,
  ProfileFactsReplySchema,
  type KitchenProfile,
  type PersonalisationOptions,
  type ProfileDetails,
} from "@culinaire/shared/schemas/account";
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

/** A picture from the phone's library or camera, ready to upload. */
export interface PickedImage {
  uri: string;
  mimeType: string;
}

/** The proof the server asks for before two-step verification is set up or removed: the password (accounts that have one), and the current code to remove it. */
export interface MfaProof {
  password?: string;
  mfaCode?: string;
}

/** Calls behind the account screens. */
export function createAccountApi(client: ApiClient, tokenStore: TokenStore) {
  /** The refresh token goes with proof-of-identity calls: the server reads when this sign-in began from it (the web sends the cookie). */
  const withRefresh = async <T extends object>(body: T) => ({ ...body, refreshToken: (await tokenStore.load())?.refreshToken });

  return {
    async details(): Promise<ProfileDetails & { userEmail: string; userPhotoPath: string | null }> {
      return (await client.request("GET", "/api/users/profile", { schema: ProfileDetailsReplySchema })).profile;
    },

    /** Every field is sent, an empty one as "" (which clears it): the server writes the six address fields together. */
    async saveDetails(details: ProfileDetails): Promise<void> {
      await client.request("PATCH", "/api/users/profile", { body: details });
    },

    /** Multipart `file`, as the web's crop sends it. The server takes PNG, JPEG and WebP up to 2 MB. */
    async uploadAvatar(image: PickedImage): Promise<string> {
      const form = new FormData();
      const ext = image.mimeType === "image/png" ? "png" : image.mimeType === "image/webp" ? "webp" : "jpg";
      // React Native's FormData takes a file as { uri, name, type }.
      form.append("file", { uri: image.uri, name: `avatar.${ext}`, type: image.mimeType } as unknown as Blob);
      return (await client.request("POST", "/api/users/profile/avatar", { body: form, schema: AvatarReplySchema })).photoPath;
    },

    /** Ends every other sign-in; this one stays (its refresh token goes in the body). */
    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
      await client.request("POST", "/api/users/change-password", { body: await withRefresh({ currentPassword, newPassword }) });
    },

    /** Starts set-up: a new secret, not yet switched on. */
    async mfaSetup(proof: MfaProof): Promise<{ secret: string; qrCodeDataUrl: string }> {
      return client.request("POST", "/api/auth/mfa/setup", { body: await withRefresh(proof), schema: MfaSetupReplySchema });
    },

    /** Switches it on with the first code the authenticator shows. */
    async mfaEnable(code: string): Promise<void> {
      await client.request("POST", "/api/auth/mfa/enable", { body: { token: code } });
    },

    async mfaDisable(proof: MfaProof): Promise<void> {
      await client.request("POST", "/api/auth/mfa/disable", { body: await withRefresh(proof) });
    },

    kitchenProfile(): Promise<KitchenProfile> {
      return client.request("GET", "/api/users/kitchen-profile", { schema: KitchenProfileSchema });
    },

    /** A partial update: only the fields given change. */
    async saveKitchenProfile(changes: Record<string, unknown>): Promise<void> {
      await client.request("PUT", "/api/users/kitchen-profile", { body: changes });
    },

    personalisationOptions(): Promise<PersonalisationOptions> {
      return client.request("GET", "/api/personalisation-options", { schema: PersonalisationOptionsSchema });
    },

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

/** One plain sentence for a refused change to two-step verification, chosen by the server's code. */
export function mfaMessage(err: unknown): { text: string; needsMfa?: true; needsFreshSignIn?: true } {
  if (err instanceof ApiError) {
    if (err.hasCode("INVALID_CREDENTIALS")) return { text: "That password isn't right." };
    if (err.hasCode("MFA_REQUIRED")) return { text: "Enter your authenticator code.", needsMfa: true };
    if (err.hasCode("INVALID_MFA_CODE")) return { text: "That authenticator code isn't valid." };
    if (err.hasCode("RECENT_SIGN_IN_REQUIRED")) return { text: "For your security, sign out, sign back in, then try again.", needsFreshSignIn: true };
    if (err.hasCode("MFA_ALREADY_ENABLED")) return { text: "Two-step verification is already on." };
    if (err.hasCode("RATE_LIMITED") || err.code === "rate_limited") return { text: "Too many tries. Wait a few minutes and try again." };
    // Enabling answers a wrong first code with a plain 400 and no code.
    if (err.code === "bad_request") return { text: "That code didn't work. Check the time on your phone and try the newest code." };
    if (err.code === "network" || err.code === "timeout") return { text: err.message };
  }
  return { text: "Something went wrong. Try again." };
}

/** The `otpauth:` link an authenticator app opens; the same issuer and label the server put in its QR code (`generateMfaSecret`). */
export function authenticatorLink(secret: string, email: string): string {
  return `otpauth://totp/${encodeURIComponent(`CulinAIre Kitchen:${email}`)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent("CulinAIre Kitchen")}`;
}

import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import type { AppleCredential } from "../api/auth";

/** Sign in with Apple exists on iPhone and iPad only. The Android build never offers it. */
export const appleEnabled = Platform.OS === "ios";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Opens Apple's sign-in sheet and returns what the server verifies, or null when the person closes the sheet.
 * Every attempt gets its own nonce, so a captured token cannot be replayed for another sign-in.
 */
export async function appleCredential(): Promise<AppleCredential | null> {
  const nonce = hex(await Crypto.getRandomBytesAsync(32));
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
  } catch (err) {
    if ((err as { code?: string }).code === "ERR_REQUEST_CANCELED") return null;
    throw err;
  }
  if (!credential.identityToken) throw new Error("Apple sent no identity token");
  return {
    identityToken: credential.identityToken,
    nonce,
    authorizationCode: credential.authorizationCode ?? undefined,
    givenName: credential.fullName?.givenName ?? undefined,
    familyName: credential.fullName?.familyName ?? undefined,
  };
}

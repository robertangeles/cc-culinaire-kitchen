import * as SecureStore from "expo-secure-store";
import type { TokenStore, Tokens } from "../api/client";

const ACCESS = "culinaire.accessToken";
const REFRESH = "culinaire.refreshToken";

/** Tokens live in the Keychain (iOS) or Keystore (Android), never in plain storage. */
export function createSecureTokenStore(): TokenStore {
  return {
    async load(): Promise<Tokens | null> {
      const [accessToken, refreshToken] = await Promise.all([SecureStore.getItemAsync(ACCESS), SecureStore.getItemAsync(REFRESH)]);
      return accessToken && refreshToken ? { accessToken, refreshToken } : null;
    },
    async save(tokens: Tokens) {
      await Promise.all([SecureStore.setItemAsync(ACCESS, tokens.accessToken), SecureStore.setItemAsync(REFRESH, tokens.refreshToken)]);
    },
    async clear() {
      await Promise.all([SecureStore.deleteItemAsync(ACCESS), SecureStore.deleteItemAsync(REFRESH)]);
    },
  };
}

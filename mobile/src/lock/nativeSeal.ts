import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { Cipher, KeyStore } from "./lockedCache";

const bytes = (text: string) => new TextEncoder().encode(text);
const importKey = (key: string) => AESEncryptionKey.import(key, "base64");

/** AES-256-GCM from expo-crypto; the sealed text is the IV, ciphertext and tag together, in base64. */
export const aesCipher: Cipher = {
  newKey: async () => (await AESEncryptionKey.generate()).encoded("base64"),
  seal: async (text, key, context) => (await aesEncryptAsync(bytes(text), await importKey(key), { additionalData: bytes(context) })).combined("base64"),
  open: async (sealed, key, context) => new TextDecoder().decode(await aesDecryptAsync(AESSealedData.fromCombined(sealed), await importKey(key), { additionalData: bytes(context) })),
};

const KEY = "culinaire.cacheKey";
/** On iOS the Keychain drops it when the passcode is removed, and it never leaves the device in a backup. Android ignores the option. */
const OPTIONS = { keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY };

/** The cache's key, in the Keychain (iOS) or Keystore (Android), where the tokens are. */
export const cacheKeyStore: KeyStore = {
  get: () => SecureStore.getItemAsync(KEY, OPTIONS),
  set: (value) => SecureStore.setItemAsync(KEY, value, OPTIONS),
  delete: () => SecureStore.deleteItemAsync(KEY, OPTIONS),
};

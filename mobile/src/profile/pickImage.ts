import * as ImagePicker from "expo-image-picker";
import type { PickedImage } from "../api/account";

/** The types the server's avatar upload takes; anything else (an iPhone's HEIC) is refused on the phone, before it is sent. */
const UPLOADABLE = ["image/jpeg", "image/png", "image/webp"];

export type PickResult = { kind: "picked"; image: PickedImage } | { kind: "cancelled" } | { kind: "denied" } | { kind: "unsupported" };

/**
 * A square picture from the library or the camera, cropped on the phone and compressed (the server's limit is a few MB).
 * The library needs no permission on Android 13+ (the system photo picker); the camera asks the first time.
 */
export async function pickImage(from: "library" | "camera"): Promise<PickResult> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.7 };
  if (from === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { kind: "denied" };
  }
  const result = from === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return { kind: "cancelled" };
  const asset = result.assets[0];
  const mimeType = asset.mimeType ?? "image/jpeg";
  if (!UPLOADABLE.includes(mimeType)) return { kind: "unsupported" };
  return { kind: "picked", image: { uri: asset.uri, mimeType } };
}

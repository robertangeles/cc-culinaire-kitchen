import * as ImagePicker from "expo-image-picker";
import type { Photo } from "../api/photo";
import { takePhoto } from "../photos/photoFiles";

export type PickResult = { kind: "picked"; photo: Photo } | { kind: "cancelled" } | { kind: "denied" } | { kind: "unsupported" };

/**
 * A square picture from the library or the camera, cropped on the phone and compressed (the server's limit is a few MB), without its place
 * and time; a format the server cannot take (an iPhone's HEIC) is refused here, before it is sent.
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
  const photo = await takePhoto(result.assets[0].uri).catch(() => null);
  return photo ? { kind: "picked", photo } : { kind: "unsupported" };
}

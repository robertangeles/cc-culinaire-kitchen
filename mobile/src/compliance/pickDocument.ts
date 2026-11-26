import * as ImagePicker from "expo-image-picker";
import { MAX_DOCUMENT_BYTES } from "@culinaire/shared/schemas/compliance";
import type { Photo } from "../api/photo";
import { takePhoto } from "../photos/photoFiles";

export type PickedDocument = { kind: "picked"; photo: Photo } | { kind: "cancelled" | "denied" | "unsupported" | "tooBig" };

/**
 * A photo of a certificate, whole (no crop) and compressed. The library needs no permission on Android 13+ and iOS (the system picker);
 * the camera asks the first time, with the reason in app.json on iPhone. An iPhone's HEIC is handed over as JPEG. (The server also stores
 * PDFs, which the phone's photo picker does not offer.)
 */
export async function pickDocument(from: "library" | "camera"): Promise<PickedDocument> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, exif: false, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };
  if (from === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { kind: "denied" };
  }
  const result = from === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return { kind: "cancelled" };
  const photo = await takePhoto(result.assets[0].uri).catch(() => null);
  if (!photo) return { kind: "unsupported" };
  return photo.bytes.length > MAX_DOCUMENT_BYTES ? { kind: "tooBig" } : { kind: "picked", photo };
}

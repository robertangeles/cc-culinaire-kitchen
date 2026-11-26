import { Directory, File, Paths } from "expo-file-system";
import type { Photo } from "../api/photo";
import { stripMetadata } from "@culinaire/shared";

/**
 * Deletes every photo the picker left in the app's cache: the camera's original and the compressed copy of it, which it never removes itself.
 * Never throws: a leftover is tried again at the next photo and at the next start (app/_layout.tsx).
 */
export function clearPickedPhotos(): void {
  try {
    const picked = new Directory(Paths.cache, "ImagePicker");
    if (picked.exists) picked.delete();
  } catch {
    // Tried again later.
  }
}

/**
 * A picked photo without its metadata, and nothing left of it on the phone. Null when it is not a whole JPEG or PNG: then it must not be sent.
 * What it is comes from its bytes, not from the picker, which names the file it started from (a WebP arrives as a PNG).
 */
export async function takePhoto(uri: string): Promise<Photo | null> {
  try {
    const bytes = stripMetadata(await new File(uri).bytes());
    return bytes && { bytes, mimeType: bytes[0] === 0x89 ? "image/png" : "image/jpeg" };
  } finally {
    clearPickedPhotos();
  }
}

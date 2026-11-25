/** A picked photo, held in memory only, without what the camera wrote into it. */
export interface Photo {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
}

/**
 * The multipart body for one photo, field `file`. Not React Native's { uri, name, type }: Expo's fetch, which replaces the global one on the
 * phone, refuses that form (convertFormData.ts in `expo`) and the send fails as if there were no signal. It takes a part with `bytes()`.
 */
export function photoForm(photo: Photo, name: string): FormData {
  const form = new FormData();
  form.append("file", { name: `${name}.${photo.mimeType === "image/png" ? "png" : "jpg"}`, type: photo.mimeType, bytes: async () => photo.bytes } as unknown as Blob);
  return form;
}

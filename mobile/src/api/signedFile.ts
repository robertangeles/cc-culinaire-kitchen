import { ApiError } from "./client";

/**
 * A file behind a short-lived signed link (a certificate's photo), read into memory as a data address. Not an <Image> on the link itself:
 * that would leave a copy of a personal document in the phone's image cache. `no-store` keeps it out of Android's HTTP disk cache too (a header,
 * because fetch's `cache` option would add a parameter to the signed link). No token is sent: the link is not our server's.
 */
export async function readSignedImage(url: string, fetchFn: typeof fetch = fetch): Promise<string> {
  let blob: Blob;
  try {
    const res = await fetchFn(url, { headers: { "Cache-Control": "no-store" } });
    if (!res.ok) throw new ApiError("not_found", "The file can't be opened any more. Try again.", res.status);
    blob = await res.blob();
  } catch (err) {
    throw err instanceof ApiError ? err : new ApiError("network");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ApiError("bad_response"));
    reader.readAsDataURL(blob);
  });
}

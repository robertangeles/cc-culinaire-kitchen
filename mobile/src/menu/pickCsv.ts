import { File } from "expo-file-system";
import { Platform } from "react-native";
import type { CsvFile } from "./menuApi";

/** The server's upload limit on the menu routes (multer, `routes/menuIntelligence.ts`). */
export const CSV_MAX_BYTES = 5 * 1024 * 1024;

export type CsvPick = { kind: "picked"; csv: CsvFile } | { kind: "cancelled" } | { kind: "refused"; reason: string };

/**
 * A CSV the person picks in the system's document picker, read into memory. Nothing of it is left on the phone: iOS hands over a copy in
 * the app's temporary folder, which is deleted here once read; on Android it is the person's own file (a content:// link), never touched.
 */
export async function pickCsv(): Promise<CsvPick> {
  const picked = await File.pickFileAsync({ mimeTypes: ["text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel"] });
  if (picked.canceled) return { kind: "cancelled" };
  const file = picked.result;
  try {
    // No extension check: Android's picker hands over a content link whose name can be an id ("msf:42"); the mime filter and the server's parse decide.
    if ((file.size ?? 0) > CSV_MAX_BYTES) return { kind: "refused", reason: "That file is over 5 MB. Split it into smaller files." };
    return { kind: "picked", csv: { name: file.name, bytes: await file.bytes() } };
  } catch {
    return { kind: "refused", reason: "That file could not be read. Pick it again." };
  } finally {
    if (Platform.OS === "ios" && file.uri.startsWith("file://")) {
      try {
        file.delete();
      } catch {
        // The system clears its temporary folder itself.
      }
    }
  }
}

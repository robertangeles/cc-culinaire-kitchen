import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** Where a shared order's PDF waits for the app it was shared to. Nothing else is kept there. */
const folder = () => new Directory(Paths.cache, "purchase-orders");

/**
 * Deletes every order PDF left in the cache. Never throws: a leftover is tried again before the next share and at the next start
 * (app/_layout.tsx).
 */
export function clearOrderPdfs(): void {
  try {
    const dir = folder();
    if (dir.exists) dir.delete();
  } catch {
    // Tried again later.
  }
}

const bytesOf = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("unreadable"));
    reader.readAsArrayBuffer(blob);
  });

/**
 * Opens the system share sheet on the order's PDF, written to the app's cache under the order number. On iOS the file is deleted as soon as
 * the sheet closes. Android answers when the chooser closes, before the app picked (mail, Drive) has read the file, so there it is
 * deleted before the next share and at the next start.
 */
export async function shareOrderPdf(pdf: Blob, poNumber: string): Promise<void> {
  clearOrderPdfs();
  const dir = folder();
  dir.create({ idempotent: true });
  const file = new File(dir, `${poNumber.replace(/[^\w.-]/g, "_") || "order"}.pdf`);
  try {
    await file.write(await bytesOf(pdf));
    await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: `Share ${poNumber}` });
  } finally {
    if (Platform.OS === "ios") clearOrderPdfs();
  }
}

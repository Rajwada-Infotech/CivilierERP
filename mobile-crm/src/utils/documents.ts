// A file the server keeps (a money receipt, an invoice) opened on the phone: downloaded with the signed-in token to
// the app's cache, then handed to the phone's own viewer / share sheet. Same file API the updater uses
// (expo-file-system/legacy, see updater/UpdateGate.tsx).
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { apiUrl } from "@/utils/apiBase";
import { getToken } from "@/services/authStorage";

const EXT: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export async function openDocument(path: string, name: string): Promise<void> {
  const token = await getToken();
  const base = String(name || "document").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^\w-]+/g, "_");
  const tmp = `${FileSystem.cacheDirectory}${base}.download`;
  await FileSystem.deleteAsync(tmp, { idempotent: true });
  const res = await FileSystem.downloadAsync(apiUrl(path), tmp, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status !== 200) {
    await FileSystem.deleteAsync(tmp, { idempotent: true });
    throw new Error(res.status === 429 ? "Too many downloads — please wait a moment and try again." : "The document could not be opened.");
  }
  const mime = (res.mimeType || res.headers?.["Content-Type"] || res.headers?.["content-type"] || "application/pdf").split(";")[0].trim();
  const target = `${FileSystem.cacheDirectory}${base}.${EXT[mime] || "pdf"}`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.moveAsync({ from: res.uri, to: target });
  if (!(await Sharing.isAvailableAsync())) throw new Error("This phone can't open the document here.");
  await Sharing.shareAsync(target, { mimeType: mime, UTI: mime === "application/pdf" ? "com.adobe.pdf" : undefined, dialogTitle: name });
}

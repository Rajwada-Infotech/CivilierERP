// Documents on the phone, for the customer screens:
//   openDocument(path, name)  a file the server keeps (an invoice, receipt, credit note, letter, an agreement or deed
//                             paper) — downloaded with the signed-in token to the app's cache, then handed to the
//                             phone's own viewer / share sheet;
//   pickDocument()            a PDF, Word file or photo from the phone, for an upload (the server's own limit:
//                             25 MB, PDF / Word / image — crmPortal.js portalDocUpload).
// Same file API the updater uses (expo-file-system/legacy, see updater/UpdateGate.tsx).
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { apiUrl } from "@/utils/apiBase";
import { getToken } from "@/services/authStorage";

const EXT: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};
export const UPLOAD_TYPES = Object.keys(EXT);
const MAX_UPLOAD = 25 * 1024 * 1024;

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

export interface PickedFile { uri: string; name: string; mimeType: string; size: number | null }

/** A file chosen by the customer, or null when they cancel. Throws a readable message for a wrong type / size. */
export async function pickDocument(): Promise<PickedFile | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: UPLOAD_TYPES, copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const mimeType = a.mimeType || "application/octet-stream";
  if (!EXT[mimeType]) throw new Error("File type not allowed — please upload a PDF, Word document, or image");
  if (a.size != null && a.size > MAX_UPLOAD) throw new Error("The file is larger than 25 MB");
  return { uri: a.uri, name: a.name, mimeType, size: a.size ?? null };
}

/** The picked file as a multipart form (field "file"), with any extra fields. */
export function fileForm(f: PickedFile, fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.append("file", { uri: f.uri, name: f.name, type: f.mimeType } as unknown as Blob);
  for (const [k, v] of Object.entries(fields)) if (v) fd.append(k, v);
  return fd;
}

/** The picked file's contents as base64 (the government-payment proof travels as JSON). */
export function fileBase64(f: PickedFile): Promise<string> {
  return FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.Base64 });
}

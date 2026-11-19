// Documents on the phone, for the customer screens:
//   openDocument(path, name)  a file the server keeps (an invoice, receipt, credit note, letter, an agreement or deed
//                             paper) — downloaded with the signed-in token to the app's cache, then handed to the
//                             phone's own viewer / share sheet;
//   pickDocument()            any file from the phone's storage (the system file manager, all files shown), checked
//                             against the server's own limit: 25 MB, PDF / Word / image (crmPortal.js portalDocUpload);
//   pickFromGallery()         a photo from the phone's gallery;
//   takePhoto() / photoFile() a photo taken with the camera, shrunk to a sensible size, as an upload;
//   pagesToPdf(pages)         photographed pages joined into one PDF.
// These are the choices of the "Upload document" sheet (customer/ui.tsx useAddPapers). On Android the system may close
// the app while the camera is open; recoverPendingUpload() hands back the photo taken, so the upload still happens.
// Same file API the updater uses (expo-file-system/legacy, see updater/UpdateGate.tsx).
import * as FileSystem from "expo-file-system/legacy";
import { File as ExpoFile } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
/** The type of a picked file: what the picker says, else what its name says (some phones report none). */
const BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
const typeOf = (mime: string | null | undefined, name: string) =>
  (mime && EXT[mime] ? mime : BY_EXT[(name.split(".").pop() || "").toLowerCase()] || (name.toLowerCase().endsWith(".jpeg") ? "image/jpeg" : null));

export async function pickDocument(): Promise<PickedFile | null> {
  // All files: the phone's own file manager opens on its storage (Downloads, internal storage, SD card; Drive is only
  // one of its sources). The type is checked after — the same rule as the server.
  const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const mimeType = typeOf(a.mimeType, a.name);
  if (!mimeType) throw new Error("That file type can't be uploaded. Please choose a PDF, a Word document, or a photo (JPG / PNG).");
  if (a.size != null && a.size > MAX_UPLOAD) throw new Error("The file is larger than 25 MB");
  return { uri: a.uri, name: a.name, mimeType, size: a.size ?? null };
}

/** A photo from the phone's gallery, or null. */
export async function pickFromGallery(): Promise<PickedFile | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, allowsMultipleSelection: false });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const name = a.fileName || `photo-${stamp()}.jpg`;
  const mimeType = typeOf(a.mimeType, name) || "image/jpeg";
  if (!mimeType.startsWith("image/")) throw new Error("Please choose a photo (JPG / PNG)");
  if (a.fileSize != null && a.fileSize > MAX_UPLOAD) throw new Error("The photo is larger than 25 MB");
  return { uri: a.uri, name, mimeType, size: a.fileSize ?? null };
}

/**
 * The picked file as a multipart form (field "file"), with any extra fields.
 * The app's fetch is Expo's (expo/winter, SDK 58), whose FormData takes a Blob or an object that hands over its bytes —
 * not React Native's old { uri, name, type } part, which fails with "Unsupported FormDataPart implementation". So the
 * part is the file's name and type plus a bytes() that reads it from disk when the request is sent.
 */
export function fileForm(f: PickedFile, fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const part = { name: f.name, type: f.mimeType, bytes: async () => new Uint8Array(await new ExpoFile(f.uri).arrayBuffer()) };
  fd.append("file", part as unknown as Blob);
  for (const [k, v] of Object.entries(fields)) if (v) fd.append(k, v);
  return fd;
}

/** The picked file's contents as base64 (the government-payment proof travels as JSON). */
export function fileBase64(f: PickedFile): Promise<string> {
  return FileSystem.readAsStringAsync(f.uri, { encoding: FileSystem.EncodingType.Base64 });
}

/** A photo taken with the camera. */
export interface Photo { uri: string; width: number; height: number }
// Digits only (YYYYMMDDHHMMSS). Not written as a bracketed character class: NativeWind scans source for class names and
// reads such a bracketed pattern as an arbitrary CSS property, which breaks the stylesheet build and stops Metro.
const stamp = () => new Date().toISOString().slice(0, 19).replace(/\D/g, "");
const tooBig = (bytes: number | null) => bytes != null && bytes > MAX_UPLOAD;
const sizeOf = async (uri: string) => { const i = await FileSystem.getInfoAsync(uri); return i.exists && "size" in i ? (i.size as number) : null; };
const PENDING = "civ_pending_upload";

/**
 * Open the camera for one photo; null when the customer backs out. `intent` names what the photo is for, so that if
 * Android closes the app while the camera is open, recoverPendingUpload() can finish that upload when it comes back.
 * Throws a readable message if the camera is off. No Base64 here: a full camera photo as text is several MB and can
 * stall the hand-over back to the app.
 */
export async function takePhoto(intent?: string): Promise<Photo | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error("Camera access is off. Allow it for Expo Go / Civilier Home in your phone's settings, or choose a file instead.");
  if (intent) await AsyncStorage.setItem(PENDING, intent);
  try {
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, exif: false });
    if (r.canceled || !r.assets?.length) return null;
    const a = r.assets[0];
    return { uri: a.uri, width: a.width, height: a.height };
  } finally {
    if (intent) await AsyncStorage.removeItem(PENDING);
  }
}

/** A photo shrunk to at most `max` pixels wide, as a JPEG file (the full camera image is never loaded whole). */
async function shrink(uri: string, max: number, compress: number, base64 = false) {
  const ref = await ImageManipulator.manipulate(uri, { maxWidth: max }).renderAsync();
  return ref.saveAsync({ compress, format: SaveFormat.JPEG, base64 });
}

/** One photo as an upload: shrunk to 2000 px wide, which keeps print quality and a small file. */
export async function photoFile(p: Photo): Promise<PickedFile> {
  const out = await shrink(p.uri, 2000, 0.8);
  const size = await sizeOf(out.uri);
  if (tooBig(size)) throw new Error("The photo is larger than 25 MB");
  return { uri: out.uri, name: `photo-${stamp()}.jpg`, mimeType: "image/jpeg", size };
}

/** Photographed pages joined into one PDF, one page each, fitted to A4 (each page shrunk to 1600 px wide first). */
export async function pagesToPdf(pages: Photo[]): Promise<PickedFile> {
  if (!pages.length) throw new Error("Take at least one page first");
  const imgs: string[] = [];
  for (const p of pages) imgs.push((await shrink(p.uri, 1600, 0.7, true)).base64 || "");
  const body = imgs.map((b64) => `<div class="page"><img src="data:image/jpeg;base64,${b64}" /></div>`).join("");
  const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><style>
    @page { margin: 0; } html, body { margin: 0; padding: 0; }
    .page { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; page-break-after: always; overflow: hidden; }
    .page:last-child { page-break-after: auto; }
    img { max-width: 100%; max-height: 100%; object-fit: contain; }
  </style></head><body>${body}</body></html>`;
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const size = await sizeOf(uri);
  if (tooBig(size)) throw new Error("The scan is larger than 25 MB — try fewer pages");
  return { uri, name: `scan-${stamp()}.pdf`, mimeType: "application/pdf", size };
}

let pending: Promise<{ intent: string; photo: Photo } | null> | null = null;
/**
 * If Android closed the app while the camera was open, the photo taken is handed back here once, with what it was
 * for (the `intent` given to takePhoto). Each upload screen asks with its own `owns` test; the first that owns it
 * takes it.
 */
export async function recoverPendingUpload(owns: (intent: string) => boolean): Promise<{ intent: string; photo: Photo } | null> {
  if (!pending) {
    pending = (async () => {
      const intent = await AsyncStorage.getItem(PENDING);
      if (!intent) return null;
      const r = await ImagePicker.getPendingResultAsync();
      await AsyncStorage.removeItem(PENDING);
      if (!r || !("assets" in r) || r.canceled || !r.assets?.length) return null;
      const a = r.assets[0];
      return { intent, photo: { uri: a.uri, width: a.width, height: a.height } };
    })().catch(() => null);
  }
  const got = await pending;
  if (!got || !owns(got.intent)) return null;
  pending = Promise.resolve(null);
  return got;
}

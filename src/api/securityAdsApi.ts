// Maintenance → Ads (super admins only): video ads for the Civilier Security app's residents. backend/routes/securityAds.js.
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type AdKind = "POPUP" | "BANNER";
export interface SecurityAd {
  id: number;
  kind: AdKind;
  title: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  isActive: boolean;
  createdAt: string;
}

async function read<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `The request failed (${res.status}).`);
  return body as T;
}

export const getAds = async () => read<SecurityAd[]>(await fetchWithAuth("/api/security-ads"));

export async function uploadAd(kind: AdKind, title: string, file: File) {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("title", title);
  fd.append("video", file);
  return read<SecurityAd>(await fetchWithAuth("/api/security-ads", { method: "POST", body: fd }));
}

export const updateAd = async (id: number, patch: { title?: string; isActive?: boolean }) =>
  read<SecurityAd>(await fetchWithAuth(`/api/security-ads/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }));

export const deleteAd = async (id: number) => read<{ success: true }>(await fetchWithAuth(`/api/security-ads/${id}`, { method: "DELETE" }));

/** The video as a local object URL for the preview (the route needs the sign-in header, which <video src> can't send). */
export async function adVideoUrl(id: number): Promise<string> {
  const res = await fetchWithAuth(`/api/security-ads/${id}/video`);
  if (!res.ok) throw new Error(`The video could not be read (${res.status}).`);
  return URL.createObjectURL(await res.blob());
}

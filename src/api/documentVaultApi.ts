import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/followup-document-vault";

export async function fetchDocumentVaultOptions() {
  const res = await fetchWithAuth(`${BASE}/meta/options`);
  if (!res.ok) throw new Error("Failed to load options");
  return res.json();
}

export async function fetchDocuments(params?: Record<string, string>) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetchWithAuth(`${BASE}${qs}`);
  if (!res.ok) throw new Error("Failed to fetch documents");
  return res.json();
}

export async function uploadDocument(formData: FormData) {
  const res = await fetchWithAuth(`${BASE}/upload`, {
    method: "POST",
    body: formData,
    // NOTE: do NOT set Content-Type — browser sets multipart boundary automatically
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Upload failed");
  }
  return res.json();
}

export async function updateDocument(id: number, payload: Record<string, unknown>) {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to update");
  }
  return res.json();
}

export async function deleteDocument(id: number) {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete document");
  return res.json();
}

/** Returns the URL to stream/download a file inline */
export function getDocumentFileUrl(id: number): string {
  return `${BASE}/file/${id}`;
}
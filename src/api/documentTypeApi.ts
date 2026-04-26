// src/api/documentTypeApi.ts
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/document-type";

// ── Fetch lists ──────────────────────────────────────────────────────────────

export const getDocumentTypes = async () => {
  const res = await fetchWithAuth(BASE_URL);
  if (!res.ok) throw new Error("Failed to fetch document types");
  return res.json();
};

/** Entry_Type master — provides EntryType label + Eprefix */
export const getEntryTypes = async () => {
  const res = await fetchWithAuth(`${BASE_URL}/entrytypes`);
  if (!res.ok) throw new Error("Failed to fetch entry types");
  return res.json();
};

/** Company dropdown */
export const getCompanies = async () => {
  const res = await fetchWithAuth(`${BASE_URL}/companies`);
  if (!res.ok) throw new Error("Failed to fetch companies");
  return res.json();
};

/** Project dropdown */
export const getProjects = async () => {
  const res = await fetchWithAuth(`${BASE_URL}/projects`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
};

// ── Mutations ────────────────────────────────────────────────────────────────

export const createDocumentType = async (data: {
  Prefix: string;
  Description: string;
  EntryTypeId: string;
  CompanyId?: number | null;
  ProjectId?: number | null;
  StartingDocNo?: number;
}) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to create document type");
  }
  return res.json();
};

export const updateDocumentType = async (
  id: number,
  data: {
    Prefix: string;
    Description: string;
    EntryTypeId: string;
    CompanyId?: number | null;
    ProjectId?: number | null;
    IsActive?: boolean;
    StartingDocNo?: number;
  },
) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to update document type");
  }
  return res.json();
};

export const deleteDocumentType = async (id: number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to deactivate document type");
  return res.json();
};

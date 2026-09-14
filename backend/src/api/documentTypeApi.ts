// src/api/documentTypeApi.ts
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/document-type";

// ── Response types ────────────────────────────────────────────────────────────

export interface DocTypeRecord {
  TypeOfDocId: number;
  Prefix: string;
  Description: string;
  CompanyId: number | null;
  ProjectId: number | null;
  EntryTypeId: string;
  IsActive: boolean;
  StartingDocNo: number;
  // joined
  EntryType: string | null;
  Eprefix: string | null;
  EDOC_N: number | null;
  FullPrefix: string | null;
  CompanyName: string;
  ProjectName: string;
  ProjectShortName: string;
  links_to: string | null;
  // migration 035 + 046
  DocNoPrefix: string | null;
  ModuleCode: string | null;
  ProjectCode: string | null;
  FinYearReset: boolean;
  CreatedAt: string | null;
  UpdatedAt: string | null;
}

export interface EntryTypeOption {
  EntryTypeId: string;
  EntryType: string;
  Eprefix: string | null;
  EDOC_N: number | null;
}

export interface CompanyOption {
  CompanyId: number;
  CompanyName: string;
}

export interface ProjectOption {
  ProjectId: number;
  ProjectName: string;
  ProjectCode: string | null; // enterprise.short_name
  CompanyId: number | null;
}

// ── Payload type shared by create + update ────────────────────────────────────

export interface DocTypePayload {
  Prefix: string;
  Description: string;
  EntryTypeId: string;
  CompanyId?: number | null;
  ProjectId?: number | null;
  IsActive?: boolean;
  StartingDocNo?: number;
  links_to?: string | null;
  // new numbering fields (migration 046)
  ModuleCode?: string | null;
  DocNoPrefix?: string | null;
  FinYearReset?: boolean;
  // ProjectCode is intentionally excluded — server resolves it from ProjectId
}

// ── Fetch lists ───────────────────────────────────────────────────────────────

export const getDocumentTypes = async (): Promise<DocTypeRecord[]> => {
  const res = await fetchWithAuth(BASE_URL);
  if (!res.ok) throw new Error("Failed to fetch document types");
  return res.json().catch(() => ({}));
};

/** Entry_Type master — provides EntryType label + Eprefix */
export const getEntryTypes = async (): Promise<EntryTypeOption[]> => {
  const res = await fetchWithAuth(`${BASE_URL}/entrytypes`);
  if (!res.ok) throw new Error("Failed to fetch entry types");
  return res.json().catch(() => ({}));
};

/** Companies dropdown (enterprise where business_type = 'C') */
export const getCompanies = async (): Promise<CompanyOption[]> => {
  const res = await fetchWithAuth(`${BASE_URL}/companies`);
  if (!res.ok) throw new Error("Failed to fetch companies");
  return res.json().catch(() => ({}));
};

/** Projects dropdown (enterprise where business_type = 'P') */
export const getProjects = async (): Promise<ProjectOption[]> => {
  const res = await fetchWithAuth(`${BASE_URL}/projects`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json().catch(() => ({}));
};

// ── Mutations ─────────────────────────────────────────────────────────────────

export const createDocumentType = async (
  data: DocTypePayload,
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to create document type");
  }
  return res.json().catch(() => ({}));
};

export const updateDocumentType = async (
  id: number,
  data: DocTypePayload,
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to update document type");
  }
  return res.json().catch(() => ({}));
};

export const deleteDocumentType = async (
  id: number,
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to deactivate document type");
  return res.json().catch(() => ({}));
};

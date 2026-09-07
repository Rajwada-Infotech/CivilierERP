import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/id-template-master";

export interface IDTemplate {
  id: number;
  projectId: number;
  projectName: string | null;
  projectAlias: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface IDTemplatePayload {
  projectId: number;
  projectAlias: string;
  isActive?: boolean;
}

async function handleError(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error || fallback);
}

export const getIDTemplates = async (): Promise<IDTemplate[]> => {
  const res = await fetchWithAuth(BASE);
  if (!res.ok) await handleError(res, "Failed to fetch ID templates");
  return res.json();
};

export const getIDTemplateByProject = async (projectId: number): Promise<IDTemplate | null> => {
  const res = await fetchWithAuth(`${BASE}/by-project/${projectId}`);
  if (res.status === 404) return null;
  if (!res.ok) await handleError(res, "Failed to fetch ID template");
  return res.json();
};

export const createIDTemplate = async (data: IDTemplatePayload): Promise<{ id: number }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to create ID template");
  return res.json();
};

export const updateIDTemplate = async (id: number, data: IDTemplatePayload): Promise<void> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to update ID template");
};

export const deleteIDTemplate = async (id: number): Promise<void> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) await handleError(res, "Failed to delete ID template");
};

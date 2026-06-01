import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/project-master";

export interface ProjectMasterPayload {
  company_id: number;
  project_name: string;
  project_initial: string;
  project_code?: string;
  financial_year?: string;
  status?: string;
}

export const getProjects = async () => {
  const res = await fetchWithAuth(BASE);
  if (!res.ok) throw new Error("Failed to load projects");
  return res.json();
};

export const createProject = async (data: Partial<ProjectMasterPayload>) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create project");
  }
  return res.json();
};

export const updateProject = async (
  id: number,
  data: Partial<ProjectMasterPayload>,
) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update project");
  }
  return res.json();
};

export const deleteProject = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.reason || err.error || "Failed to delete project");
  }
  return res.json();
};

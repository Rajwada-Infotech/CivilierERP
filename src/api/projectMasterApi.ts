import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/project-master";

export const getProjects = async () => {
  const res = await fetchWithAuth(BASE);
  if (!res.ok) throw new Error("Failed to load projects");
  return res.json();
};

export const createProject = async (data: Record<string, any>) => {
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

export const updateProject = async (id: number, data: Record<string, any>) => {
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
  if (!res.ok) throw new Error("Failed to delete project");
  return res.json();
};

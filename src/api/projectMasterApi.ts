// src/api/projectMasterApi.ts
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export const getProjects = async () => {
  const res = await fetchWithAuth("/api/project-master");
  if (!res.ok) throw new Error("Failed to load projects");
  return res.json();
};

export const createProject = async (formData: FormData) => {
  const res = await fetchWithAuth("/api/project-master", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create project");
  }
  return res.json();
};

export const updateProject = async (id: number, formData: FormData) => {
  const res = await fetchWithAuth(`/api/project-master/${id}`, {
    method: "PUT",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update project");
  }
  return res.json();
};

export const deleteProject = async (id: number) => {
  const res = await fetchWithAuth(`/api/project-master/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete project");
  return res.json();
};

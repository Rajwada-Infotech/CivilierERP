import { fetchWithAuth } from "@/lib/fetchWithAuth";

export const getCompanyOptions = async () => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=C");
  if (!res.ok) throw new Error("Failed to fetch companies");
  return res.json();
};

export const getProjectOptions = async () => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=P");
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
};

export const getItemOptions = async () => {
  // Connects directly to the custom route in backend/routes/materialIssues.js
  const res = await fetchWithAuth("/api/material-issues/item-options");
  if (!res.ok) throw new Error("Failed to fetch items");
  return res.json();
};

export const getUomOptions = async () => {
  const res = await fetchWithAuth("/api/uom-master");
  if (!res.ok) throw new Error("Failed to fetch UOMs");
  const data = await res.json();
  // Filter out inactive UOMs to prevent selection of retired units
  return (Array.isArray(data) ? data : []).filter((u: any) => u.IsActive !== false);
};

export const getIssues = async (params: { page: number; limit: number; search: string }) => {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
    search: params.search,
  });
  const res = await fetchWithAuth(`/api/material-issues?${query.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch issues");
  return res.json();
};

export const previewNextIssueNumber = async (exb = false) => {
  const query = new URLSearchParams();
  if (exb) query.set("exb", "true");
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const res = await fetchWithAuth(`/api/material-issues/next-number${suffix}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to preview issue number");
  }
  return res.json();
};

export const createIssue = async (payload: any) => {
  const res = await fetchWithAuth("/api/material-issues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create issue");
  }
  return res.json();
};

export const updateIssue = async (id: number, payload: any) => {
  const res = await fetchWithAuth(`/api/material-issues/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update issue");
  }
  return res.json();
};

export const deleteIssue = async (id: number) => {
  const res = await fetchWithAuth(`/api/material-issues/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete issue");
  }
  return res.json();
};

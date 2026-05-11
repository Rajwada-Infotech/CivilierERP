import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/material-issues";

export const getCompanies = async () => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=C");
  if (!res.ok) throw new Error("Failed to fetch companies");
  return res.json();
};

export const getProjects = async () => {
  const res = await fetchWithAuth(`${BASE}/projects`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
};

export const getFinYears = async () => {
  const res = await fetchWithAuth(`${BASE}/fin-years`);
  if (!res.ok) throw new Error("Failed to fetch financial years");
  return res.json();
};

export const getItemOptions = async () => {
  const res = await fetchWithAuth(`${BASE}/item-options`);
  if (!res.ok) throw new Error("Failed to fetch items");
  return res.json();
};

export const getUomOptions = async () => {
  const res = await fetchWithAuth("/api/uom-master");
  if (!res.ok) throw new Error("Failed to fetch UOMs");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

export const getStockBalance = async (itemId: string) => {
  const res = await fetchWithAuth(
    `${BASE}/stock/${encodeURIComponent(itemId)}`,
  );
  if (!res.ok) throw new Error("Failed to fetch stock");
  return res.json() as Promise<{
    stockIn: number;
    stockOut: number;
    balance: number;
  }>;
};

export const getIssues = async (params: {
  page: number;
  limit: number;
  search: string;
}) => {
  const q = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
    search: params.search,
  });
  const res = await fetchWithAuth(`${BASE}?${q}`);
  if (!res.ok) throw new Error("Failed to fetch issues");
  return res.json();
};

export const getIssue = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error("Failed to fetch issue");
  return res.json();
};

export const previewNextIssueNumber = async (exb = false) => {
  const suffix = exb ? "?exb=true" : "";
  const res = await fetchWithAuth(`${BASE}/next-number${suffix}`);
  if (!res.ok) throw new Error("Failed to preview issue number");
  return res.json();
};

export const createIssue = async (payload: any) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to create issue");
  }
  return res.json();
};

export const updateIssue = async (id: number, payload: any) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to update issue");
  }
  return res.json();
};

export const deleteIssue = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to delete issue");
  }
  return res.json();
};

// Legacy compatibility exports
export const getCompanyOptions = getCompanies;
export const getProjectOptions = getProjects;

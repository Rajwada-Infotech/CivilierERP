// RN port of the fetch logic in src/pages/admin/WidgetsRights.tsx (web) —
// same endpoints (/api/widgets/catalog, /api/user-widget-rights/*).
import { fetchWithAuth } from "@/services/fetchWithAuth";

export interface WidgetCatalogItem {
  key: string;
  label: string;
  iconKey: string;
  category: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

export const getWidgetCatalog = async (): Promise<WidgetCatalogItem[]> => {
  const res = await fetchWithAuth("/api/widgets/catalog");
  if (!res.ok) throw new Error("Failed to load widget catalog");
  return res.json().catch(() => []);
};

export interface WidgetRightsUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

export const fetchWidgetRightsUsers = async (): Promise<WidgetRightsUser[]> => {
  const res = await fetchWithAuth("/api/user-widget-rights/users");
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json().catch(() => []);
};

export const fetchUserWidgets = async (userId: number): Promise<string[]> => {
  const res = await fetchWithAuth(`/api/user-widget-rights/${userId}`);
  if (!res.ok) throw new Error("Failed to fetch widget rights");
  const data = await res.json().catch(() => ({}));
  return data.allowedWidgets ?? [];
};

export const saveUserWidgets = async (userId: number, allowedWidgets: string[]): Promise<void> => {
  const res = await fetchWithAuth(`/api/user-widget-rights/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowedWidgets }),
  });
  if (!res.ok) throw new Error("Failed to save widget rights");
};

export const fetchRoleWidgets = async (roleId: number): Promise<string[]> => {
  const res = await fetchWithAuth(`/api/user-widget-rights/role/${roleId}`);
  if (!res.ok) throw new Error("Failed to fetch role widget rights");
  const data = await res.json().catch(() => ({}));
  return data.allowedWidgets ?? [];
};

export const saveRoleWidgets = async (roleId: number, allowedWidgets: string[]): Promise<void> => {
  const res = await fetchWithAuth(`/api/user-widget-rights/role/${roleId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowedWidgets }),
  });
  if (!res.ok) throw new Error("Failed to save role widget rights");
};

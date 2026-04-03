const BASE = "http://localhost:5000/api/tenants";

export const getTenants = async () => {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error("Failed to fetch tenants");
  return res.json();
};

export const getTenant = async (id: string) => {
  const res = await fetch(`${BASE}/${id}`);
  if (!res.ok) throw new Error("Tenant not found");
  return res.json();
};

export const createTenant = async (data: {
  tenant_id: string;
  name: string;
  domain?: string;
  admin_email?: string;
  plan?: string;
  max_users?: number;
  db_name?: string;
  server?: string;
}) => {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create tenant");
  return res.json();
};

export const updateTenant = async (id: string, data: Partial<{
  tenant_id: string;
  name: string;
  domain: string;
  admin_email: string;
  plan: string;
  max_users: number;
  db_name: string;
  server: string;
  status: string;
}>) => {
  const res = await fetch(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update tenant");
  return res.json();
};

export const patchTenantStatus = async (id: string, status: "active" | "suspended") => {
  const res = await fetch(`${BASE}/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update tenant status");
  return res.json();
};

export const deleteTenant = async (id: string) => {
  const res = await fetch(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete tenant");
  return res.json();
};

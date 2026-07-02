import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/dba";

export const getDbTables = async (tenantId?: string) => {
  const url = tenantId ? `${BASE}/tables?tenant_id=${tenantId}` : `${BASE}/tables`;
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error("Failed to fetch tables");
  return res.json().catch(() => ({}));
};

export const getTableRowCount = async (tableName: string) => {
  const res = await fetchWithAuth(`${BASE}/tables/${tableName}/count`);
  if (!res.ok) throw new Error("Failed to fetch row count");
  return res.json().catch(() => ({}));
};

export const runSelectQuery = async (query: string, tenantId?: string) => {
  const res = await fetchWithAuth(`${BASE}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, tenant_id: tenantId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Query failed");
  }
  return res.json().catch(() => ({}));
};

export const runWriteQuery = async (query: string, tenantId?: string, confirmed = false) => {
  const res = await fetchWithAuth(`${BASE}/query/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, tenant_id: tenantId, confirmed }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Write query failed");
  }
  return res.json().catch(() => ({}));
};

export const getQueryHistory = async () => {
  const res = await fetchWithAuth(`${BASE}/query-history`);
  if (!res.ok) throw new Error("Failed to fetch query history");
  return res.json().catch(() => ({}));
};

export const getDbHealth = async () => {
  const res = await fetchWithAuth(`${BASE}/health`);
  if (!res.ok) throw new Error("Failed to fetch DB health");
  return res.json().catch(() => ({}));
};

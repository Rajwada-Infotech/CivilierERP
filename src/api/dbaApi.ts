const BASE = "/api/dba";

export const getDbTables = async (tenantId?: string) => {
  const url = tenantId ? `${BASE}/tables?tenant_id=${tenantId}` : `${BASE}/tables`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch tables");
  return res.json();
};

export const getTableRowCount = async (tableName: string) => {
  const res = await fetch(`${BASE}/tables/${tableName}/count`);
  if (!res.ok) throw new Error("Failed to fetch row count");
  return res.json();
};

export const runSelectQuery = async (query: string, tenantId?: string) => {
  const res = await fetch(`${BASE}/query`, {
    method: "POST",
    body: JSON.stringify({ query, tenant_id: tenantId }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Query failed");
  }
  return res.json();
};

export const runWriteQuery = async (query: string, tenantId?: string, confirmed = false) => {
  const res = await fetch(`${BASE}/query/write`, {
    method: "POST",
    body: JSON.stringify({ query, tenant_id: tenantId, confirmed }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error ?? "Write query failed");
  }
  return res.json();
};

export const getQueryHistory = async () => {
  const res = await fetch(`${BASE}/query-history`);
  if (!res.ok) throw new Error("Failed to fetch query history");
  return res.json();
};

export const getDbHealth = async () => {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error("Failed to fetch DB health");
  return res.json();
};

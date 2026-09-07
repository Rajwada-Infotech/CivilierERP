// RN port of src/api/godownsApi.ts (trimmed to what Stock.tsx reads) +
// src/api/inventoryMasterApi.ts, which is what the web "Stock" page
// actually renders — a current-balance (item × godown) view, despite the
// page's pageKey being "stock-ledger". See stockLedgerApi.ts for the
// separate (real, paginated) transaction-history endpoint used by the
// mobile-only ledger drill-down — web has a working backend route for it
// but never wired it into any page.
import { fetchWithAuth } from "@/services/fetchWithAuth";

function normalizeArray<T>(payload: any): T[] {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
}

export interface Godown {
  id: number;
  name: string;
  code: string | null;
  companyId: number | null;
  projectId: number | null;
  companyName: string | null;
  projectName: string | null;
  location: string | null;
  shortDesc: string | null;
  description: string | null;
  remarks: string | null;
  isActive: boolean;
  isMain: boolean;
}

export const getGodowns = async (): Promise<Godown[]> => {
  const raw = await fetchWithAuth("/api/godowns").then((r) => r.json().catch(() => ({})));
  return normalizeArray<any>(raw).map((g) => ({
    id: g.GodownID, name: g.GodownName, code: g.GodownCode ?? null,
    companyId: g.EnterpriseID ?? null, projectId: g.ProjectID ?? null,
    companyName: g.EnterpriseName ?? null, projectName: g.ProjectName ?? null,
    location: g.Location ?? null, shortDesc: g.ShortDesc ?? null, description: g.Description ?? null, remarks: g.Remarks ?? null,
    isActive: g.IsActive !== false, isMain: !!g.IsMain,
  }));
};

export interface NameOption { id: string; name: string }

export const getCompanies = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=C").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((c) => ({ id: String(c.id), name: c.label ?? "" }));
};

export const getProjects = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=P").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((p) => ({ id: String(p.id), name: p.label ?? "" }));
};

export interface InventoryMasterRow {
  ItemID: string;
  ItemName: string | null;
  ItemGroupName: string | null;
  UOMName: string | null;
  UOMCode: string | null;
  UOMSymbol: string | null;
  OpeningStock: number;
  StockIn: number;
  StockOut: number;
  ClosingStock: number;
}

export interface InventoryMasterResponse {
  data: InventoryMasterRow[];
  total: number;
  date: string;
  godownId: number | null;
  godownName: string | null;
}

export const getInventoryMaster = async (
  date: string, godownId?: number | null, dateFrom?: string, dateTo?: string,
): Promise<InventoryMasterResponse> => {
  const qs = new URLSearchParams({ date });
  if (godownId != null) qs.set("godownId", String(godownId));
  if (dateFrom) qs.set("dateFrom", dateFrom);
  if (dateTo) qs.set("dateTo", dateTo);
  const res = await fetchWithAuth(`/api/inventory-master?${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch stock (${res.status})`);
  return res.json().catch(() => ({ data: [], total: 0, date, godownId: godownId ?? null, godownName: null }));
};

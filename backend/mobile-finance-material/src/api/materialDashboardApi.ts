// RN port of the data-fetch slice of src/pages/material/MaterialDashboard.tsx
// — same /api/material-dashboard endpoint and default-fallback shape.
import { fetchWithAuth } from "@/services/fetchWithAuth";

export interface MaterialDashboardData {
  items: { count: number; groupCount: number };
  grns: { total: number; thisMonth: number; today: number; totalValue: number; thisMonthValue: number };
  purchaseOrders: { total: number; open: number; approved: number; pending: number; totalValue: number; openValue: number };
  expenses: { total: number; pending: number; approved: number; totalAmount: number; pendingAmount: number };
  stock: { totalEntries: number; totalIn: number; totalOut: number; uniqueItems: number };
  materialIssues: { total: number; thisMonth: number; today: number; totalQty: number };
  materialRequests: { total: number; pending: number; approved: number; draft: number; ordered: number; partiallyOrdered: number; thisMonth: number };
  recentGRNs: Array<{ GRNID: number; GRNNo?: string; SupplierName?: string; GRNDate?: string; TotalAmount?: number; Status?: string }>;
  recentPOs: Array<{ PurchaseOrderID: number; PurchaseOrderNo?: string; SupplierName?: string; PODate?: string; TotalAmount?: number; Status?: string }>;
}

const EMPTY: MaterialDashboardData = {
  items: { count: 0, groupCount: 0 },
  grns: { total: 0, thisMonth: 0, today: 0, totalValue: 0, thisMonthValue: 0 },
  purchaseOrders: { total: 0, open: 0, approved: 0, pending: 0, totalValue: 0, openValue: 0 },
  expenses: { total: 0, pending: 0, approved: 0, totalAmount: 0, pendingAmount: 0 },
  stock: { totalEntries: 0, totalIn: 0, totalOut: 0, uniqueItems: 0 },
  materialIssues: { total: 0, thisMonth: 0, today: 0, totalQty: 0 },
  materialRequests: { total: 0, pending: 0, approved: 0, draft: 0, ordered: 0, partiallyOrdered: 0, thisMonth: 0 },
  recentGRNs: [],
  recentPOs: [],
};

export async function fetchMaterialDashboard(): Promise<MaterialDashboardData> {
  const res = await fetchWithAuth("/api/material-dashboard");
  if (!res.ok) throw new Error("Failed to fetch material dashboard");
  const raw = await res.json().catch(() => ({}));
  return { ...EMPTY, ...raw };
}

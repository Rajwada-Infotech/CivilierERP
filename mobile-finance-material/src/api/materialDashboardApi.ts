// RN port of the data-fetch slice of src/pages/material/MaterialDashboard.tsx and its dashboard/shared.tsx
// normalise() — same /api/material-dashboard endpoint and the same default-fallback shape, plus the drill lists
// (dashboard/DrillDialog.tsx) behind each figure.
import { fetchWithAuth } from "@/services/fetchWithAuth";

export type PipelineKey =
  | "mr-unapproved" | "mr-pending" | "mr-overdue"
  | "po-unapproved" | "po-pending" | "po-overdue"
  | "grn-unapproved" | "grn-pending" | "grn-overdue";
export type DrillKey = "items" | "grns" | "pos" | "expenses" | "stock" | "issues" | "requests" | PipelineKey;

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
  recentExpenses: Array<{ Eid: number; EDocNo?: string; EProjectName?: string; EDocDate?: string; EAmount?: number; EStatus?: string }>;
  recentIssues: Array<{ IssueId: number; DocNo?: string; ProjectName?: string; IssueDate?: string; Date?: string; ItemCount?: number; Status?: string }>;
  recentRequests: Array<{ MRId: number; DocNo?: string; ProjectName?: string; RequestDate?: string; Priority?: string; Status?: string }>;
  poStatusBreakdown: { Status: string; Count: number; TotalValue: number }[];
  topItems: { ItemID: string; ItemName: string | null; TotalIn: number; TotalOut: number; NetStock: number }[];
  timeline: { date: string; grn: number; po: number }[];
  /** MR -> PO -> GRN figures, keyed "mr-unapproved" ... "grn-overdue"; null when the server couldn't work them out. */
  pipeline: Record<string, number> | null;
  grnInvoiceDays: number;
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
  recentExpenses: [],
  recentIssues: [],
  recentRequests: [],
  poStatusBreakdown: [],
  topItems: [],
  timeline: [],
  pipeline: null,
  grnInvoiceDays: 7,
};

export async function fetchMaterialDashboard(): Promise<MaterialDashboardData> {
  const res = await fetchWithAuth("/api/material-dashboard");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  const raw = await res.json().catch(() => ({}));
  return { ...EMPTY, ...raw, grns: { ...EMPTY.grns, ...raw?.grns }, pipeline: raw?.pipeline ?? null, grnInvoiceDays: raw?.grnInvoiceDays ?? 7 };
}

const isOpenPO = (status: string | null | undefined) => !["Closed", "Rejected", "Received", "Cancelled"].includes(status || "");
const rowsOf = (j: any): any[] => (Array.isArray(j) ? j : (j?.data ?? []));

/** Where each drill list comes from; the list endpoints don't filter by status, so "open" / "pending" are picked here. */
export const DRILL_SOURCE: Record<DrillKey, { url: string; pick?: (r: any) => boolean }> = {
  items: { url: "/api/item-master" },
  grns: { url: "/api/grns?page=1&limit=200" },
  pos: { url: "/api/purchase-orders?page=1&limit=200", pick: (r) => isOpenPO(r.Status) },
  expenses: { url: "/api/expense-booking", pick: (r) => (r.EStatus || "") === "Pending" },
  stock: { url: "/api/stock-transfers?page=1&limit=200" },
  issues: { url: "/api/material-issues?page=1&limit=200&search=" },
  requests: { url: "/api/material-requests?page=1&limit=200" },
  "mr-unapproved": { url: "/api/material-dashboard/pipeline/mr-unapproved" },
  "mr-pending": { url: "/api/material-dashboard/pipeline/mr-pending" },
  "mr-overdue": { url: "/api/material-dashboard/pipeline/mr-overdue" },
  "po-unapproved": { url: "/api/material-dashboard/pipeline/po-unapproved" },
  "po-pending": { url: "/api/material-dashboard/pipeline/po-pending" },
  "po-overdue": { url: "/api/material-dashboard/pipeline/po-overdue" },
  "grn-unapproved": { url: "/api/material-dashboard/pipeline/grn-unapproved" },
  "grn-pending": { url: "/api/material-dashboard/pipeline/grn-pending" },
  "grn-overdue": { url: "/api/material-dashboard/pipeline/grn-overdue" },
};

export async function fetchDrill(key: DrillKey): Promise<any[]> {
  const src = DRILL_SOURCE[key];
  const res = await fetchWithAuth(src.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = rowsOf(await res.json().catch(() => []));
  return src.pick ? rows.filter(src.pick) : rows;
}

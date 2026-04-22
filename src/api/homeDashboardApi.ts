// src/api/homeDashboardApi.ts
// Single aggregated fetch for the Home page dashboard stats & activity feed.

import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── Response shapes (mirroring backend JSON) ─────────────────────────────────

export interface FinanceDashboardData {
  payments: {
    totalCount: number;
    todayCount: number;
    totalAmount: number;
    todayAmount: number;
  };
  purchaseOrders: {
    totalCount: number;
    openCount: number;
    totalValue: number;
    openValue: number;
  };
  grns: {
    totalCount: number;
    thisMonthCount: number;
  };
  cheques: {
    totalCount: number;
    pendingCount: number;
  };
  parties: {
    supplierCount: number;
    customerCount: number;
    activeGLCount: number;
  };
  recentPayments: RecentPayment[];
  recentPOs: RecentPO[];
}

export interface RecentPayment {
  PPaymentID: number;
  PPaymentName: string;
  PMode: string;
  PAmount: number;
  PDate: string;
  PBankName: string;
  PDocType: string;
  PProject: string;
  PCreatedAt: string;
}

export interface RecentPO {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  PODate: string;
  TotalAmount: number;
  Status: string;
  SupplierName: string;
  ItemDescription: string;
}

export interface MaterialDashboardData {
  items: { count: number; groupCount: number };
  grns: { total: number; thisMonth: number; today: number };
  purchaseOrders: { total: number; open: number; openValue: number };
  workOrders: { total: number };
  recentGRNs: RecentGRN[];
  recentPOs: RecentPO[];
}

export interface RecentGRN {
  GRNID: number;
  GRNNo: string;
  GRNDate: string;
  Status: string;
  SupplierName: string;
  PONumber: string;
}

export interface AdminDashboardData {
  success: boolean;
  stats: {
    totalUsers: number;
    totalRoles: number;
    activeUsers: number;
  };
  recentUsers: RecentUser[];
  timestamp: string;
}

export interface RecentUser {
  id: number;
  name: string;
  email: string;
  created_datetime: string;
  discontinue: number;
}

export interface ApprovalInboxItem {
  Module: string;
  ModuleLabel: string;
  RecordId: string;
  Reference: string;
  RecordDate: string;
  Status: string;
  Amount: number | null;
}

export interface TaskSummary {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueDate: string;
  assignedToName: string;
}

// ─── Aggregated home dashboard shape ─────────────────────────────────────────

export interface HomeDashboardData {
  finance: FinanceDashboardData | null;
  material: MaterialDashboardData | null;
  admin: AdminDashboardData | null;
  pendingApprovals: ApprovalInboxItem[];
  recentTasks: TaskSummary[];
  errors: Record<string, string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function safeFetch<T>(url: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetchWithAuth(url);
    if (!res.ok) return { data: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message ?? "Unknown error" };
  }
}

// ─── Main fetcher ─────────────────────────────────────────────────────────────

export async function fetchHomeDashboard(isAdmin: boolean): Promise<HomeDashboardData> {
  const baseRequests = [
    safeFetch<FinanceDashboardData>("/api/finance-dashboard"),
    safeFetch<MaterialDashboardData>("/api/material-dashboard"),
    safeFetch<ApprovalInboxItem[]>("/api/approval-inbox"),
    safeFetch<{ data: TaskSummary[] }>("/api/tasks?limit=5&sort=dueDate&order=asc"),
  ] as const;

  const adminRequest = isAdmin
    ? safeFetch<AdminDashboardData>("/api/admin-dashboard")
    : Promise.resolve({ data: null, error: null });

  const [financeRes, materialRes, approvalRes, tasksRes, adminRes] = await Promise.all([
    ...baseRequests,
    adminRequest,
  ]);

  const errors: Record<string, string> = {};
  if (financeRes.error)  errors.finance  = financeRes.error;
  if (materialRes.error) errors.material = materialRes.error;
  if (approvalRes.error) errors.approvals = approvalRes.error;
  if (tasksRes.error)    errors.tasks    = tasksRes.error;
  if (adminRes.error)    errors.admin    = adminRes.error;

  return {
    finance:          financeRes.data,
    material:         materialRes.data,
    admin:            adminRes.data,
    pendingApprovals: Array.isArray(approvalRes.data) ? approvalRes.data : [],
    recentTasks:      tasksRes.data?.data ?? (Array.isArray(tasksRes.data) ? tasksRes.data as unknown as TaskSummary[] : []),
    errors,
  };
}

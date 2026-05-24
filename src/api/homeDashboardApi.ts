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

interface FinanceDashboardApiData {
  payments?: FinanceDashboardData["payments"];
  purchaseOrders?: FinanceDashboardData["purchaseOrders"];
  grns?: FinanceDashboardData["grns"];
  cheques?: FinanceDashboardData["cheques"];
  parties?: FinanceDashboardData["parties"];
  recentPayments?: RecentPayment[];
  recentPOs?: RecentPO[];
  paymentsMade?: {
    totalCount: number;
    todayCount: number;
    totalAmount: number;
    todayAmount: number;
  };
  receivedPayments?: {
    totalCount: number;
    todayCount: number;
    totalAmount: number;
    todayAmount: number;
  };
  recentPaymentsMade?: RecentPayment[];
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

export interface TicketSummaryData {
  total: number;
  pending: number;
  inProgress: number;
  resolved: number;
  closed: number;
  urgent: number;
  high: number;
  resolvedPct: number;
}

export interface EngineeringSummaryData {
  workOrders: {
    total: number;
    open: number;
    thisMonth: number;
    totalValue: number;
  };
  boq: { total: number; approved: number; totalValue: number };
  workDone: { total: number; pending: number; certifiedAmount: number };
  projects: { total: number; active: number };
}

export interface FollowupSummaryData {
  applications: number;
  bookings: number;
  confirmedBookings: number;
  agreements: number;
  activeAgreements: number;
  nocs: number;
  pendingNOCs: number;
  handovers: number;
  scheduledHandovers: number;
}

// ─── Aggregated home dashboard shape ─────────────────────────────────────────

export interface HomeDashboardData {
  finance: FinanceDashboardData | null;
  material: MaterialDashboardData | null;
  admin: AdminDashboardData | null;
  pendingApprovals: ApprovalInboxItem[];
  recentTasks: TaskSummary[];
  tickets: TicketSummaryData | null;
  engineering: EngineeringSummaryData | null;
  followup: FollowupSummaryData | null;
  errors: Record<string, string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function safeFetch<T>(
  url: string,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetchWithAuth(url);
    if (!res.ok) return { data: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err.message ?? "Unknown error" };
  }
}

function normalizeFinanceDashboard(
  raw: FinanceDashboardApiData | null,
): FinanceDashboardData | null {
  if (!raw) return null;

  return {
    payments: raw.payments ?? {
      totalCount: raw.paymentsMade?.totalCount ?? 0,
      todayCount: raw.paymentsMade?.todayCount ?? 0,
      totalAmount: raw.paymentsMade?.totalAmount ?? 0,
      todayAmount: raw.paymentsMade?.todayAmount ?? 0,
    },
    purchaseOrders: raw.purchaseOrders ?? {
      totalCount: 0,
      openCount: 0,
      totalValue: 0,
      openValue: 0,
    },
    grns: raw.grns ?? {
      totalCount: 0,
      thisMonthCount: 0,
    },
    cheques: raw.cheques ?? {
      totalCount: 0,
      pendingCount: 0,
    },
    parties: raw.parties ?? {
      supplierCount: 0,
      customerCount: 0,
      activeGLCount: 0,
    },
    recentPayments: raw.recentPayments ?? raw.recentPaymentsMade ?? [],
    recentPOs: raw.recentPOs ?? [],
  };
}

// ─── Main fetcher ─────────────────────────────────────────────────────────────

export async function fetchHomeDashboard(
  isAdmin: boolean,
): Promise<HomeDashboardData> {
  const baseRequests = [
    safeFetch<FinanceDashboardApiData>("/api/finance-dashboard"),
    safeFetch<MaterialDashboardData>("/api/material-dashboard"),
    safeFetch<ApprovalInboxItem[]>("/api/approval-inbox"),
    safeFetch<{ data: TaskSummary[] }>(
      "/api/tasks?limit=5&sort=dueDate&order=asc",
    ),
    safeFetch<unknown>("/api/tickets?limit=500"),
    safeFetch<EngineeringSummaryData>("/api/engineering/dashboard"),
    safeFetch<unknown>("/api/followup-applications?pageSize=500"),
    safeFetch<unknown>("/api/followup-bookings?pageSize=500"),
    safeFetch<unknown>("/api/followup-agreements?pageSize=500"),
    safeFetch<unknown>("/api/followup-noc?pageSize=500"),
    safeFetch<unknown>("/api/followup-handover?pageSize=500"),
    // Fetch active project count independently — engineering/dashboard is
    // permission-gated so non-engineering users would always see 0 otherwise.
    safeFetch<unknown>("/api/project-master"),
  ] as const;

  const adminRequest = isAdmin
    ? safeFetch<AdminDashboardData>("/api/admin-dashboard")
    : Promise.resolve({ data: null, error: null });

  const [
    financeRes,
    materialRes,
    approvalRes,
    tasksRes,
    ticketsRes,
    engineeringRes,
    appRes,
    bookingsRes,
    agreementsRes,
    nocRes,
    handoverRes,
    projectMasterRes,
    adminRes,
  ] = await Promise.all([...baseRequests, adminRequest]);

  const errors: Record<string, string> = {};
  if (financeRes.error) errors.finance = financeRes.error;
  if (materialRes.error) errors.material = materialRes.error;
  if (approvalRes.error) errors.approvals = approvalRes.error;
  if (tasksRes.error) errors.tasks = tasksRes.error;
  if (ticketsRes.error) errors.tickets = ticketsRes.error;
  if (engineeringRes.error) errors.engineering = engineeringRes.error;
  if (adminRes.error) errors.admin = adminRes.error;

  // Unwrap ticket list (may be raw array or { data: [], pagination: {} })
  let tickets: TicketSummaryData | null = null;
  if (!ticketsRes.error) {
    const raw = ticketsRes.data;
    const rawTickets: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as any)?.data)
        ? (raw as any).data
        : [];
    const total = rawTickets.length;
    const pending = rawTickets.filter((t) => t.status === "Pending").length;
    const inProgress = rawTickets.filter(
      (t) => t.status === "InProgress",
    ).length;
    const resolved = rawTickets.filter((t) => t.status === "Resolved").length;
    const closed = rawTickets.filter((t) => t.status === "Closed").length;
    const openStatuses = ["Pending", "InProgress"];
    const urgent = rawTickets.filter(
      (t) => t.priority === "Urgent" && openStatuses.includes(t.status),
    ).length;
    const high = rawTickets.filter(
      (t) => t.priority === "High" && openStatuses.includes(t.status),
    ).length;
    tickets = {
      total,
      pending,
      inProgress,
      resolved,
      closed,
      urgent,
      high,
      resolvedPct: total > 0 ? Math.round((resolved / total) * 100) : 0,
    };
  }

  const engRaw = engineeringRes.data as any;

  // Compute active project count from the project-master list — this works for
  // ALL roles because /api/project-master has no engineering permission gate.
  // The engineering dashboard count is used when available (admins/engineers),
  // otherwise we fall back to the project-master list.
  const projectMasterList: any[] = (() => {
    const d = projectMasterRes.data;
    return Array.isArray(d)
      ? d
      : Array.isArray((d as any)?.data)
        ? (d as any).data
        : [];
  })();
  const activeProjectsFromMaster = projectMasterList.filter(
    (p: any) =>
      p.IsActive === 1 ||
      p.isActive === true ||
      p.discontinue === 0 ||
      p.discontinue === false,
  ).length;

  const engineering: EngineeringSummaryData | null = engRaw
    ? {
        workOrders: engRaw.workOrders ?? {
          total: 0,
          open: 0,
          thisMonth: 0,
          totalValue: 0,
        },
        boq: engRaw.boq ?? { total: 0, approved: 0, totalValue: 0 },
        workDone: engRaw.workDone ?? {
          total: 0,
          pending: 0,
          certifiedAmount: 0,
        },
        projects: {
          total: engRaw.projects?.total ?? projectMasterList.length,
          // Prefer engineering dashboard count; fall back to project-master list
          active: engRaw.projects?.active ?? activeProjectsFromMaster,
        },
      }
    : {
        // Engineering dashboard unreachable (permission gate) — still show project counts
        workOrders: { total: 0, open: 0, thisMonth: 0, totalValue: 0 },
        boq: { total: 0, approved: 0, totalValue: 0 },
        workDone: { total: 0, pending: 0, certifiedAmount: 0 },
        projects: {
          total: projectMasterList.length,
          active: activeProjectsFromMaster,
        },
      };

  // Helper to unwrap paginated or raw array responses
  const unwrap = (res: { data: unknown }) => {
    const d = res.data;
    return Array.isArray(d)
      ? d
      : Array.isArray((d as any)?.data)
        ? (d as any).data
        : [];
  };
  const applications: any[] = unwrap(appRes);
  const bookings: any[] = unwrap(bookingsRes);
  const agreements: any[] = unwrap(agreementsRes);
  const nocs: any[] = unwrap(nocRes);
  const handovers: any[] = unwrap(handoverRes);
  const followup: FollowupSummaryData = {
    applications: applications.length,
    bookings: bookings.length,
    confirmedBookings: bookings.filter((b) => b.Status === "Confirmed").length,
    agreements: agreements.length,
    activeAgreements: agreements.filter((a) => a.Status === "Signed").length,
    nocs: nocs.length,
    pendingNOCs: nocs.filter((n) => n.Status === "Pending").length,
    handovers: handovers.length,
    scheduledHandovers: handovers.filter((h) => h.Status === "Scheduled")
      .length,
  };

  return {
    finance: normalizeFinanceDashboard(financeRes.data),
    material: materialRes.data,
    admin: adminRes.data,
    pendingApprovals: Array.isArray(approvalRes.data) ? approvalRes.data : [],
    recentTasks:
      tasksRes.data?.data ??
      (Array.isArray(tasksRes.data)
        ? (tasksRes.data as unknown as TaskSummary[])
        : []),
    tickets,
    engineering,
    followup,
    errors,
  };
}

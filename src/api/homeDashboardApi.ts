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
    thisMonthAmount: number;
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
    thisMonthAmount?: number;
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
  recentExpenses: RecentExpense[];
}

export interface RecentGRN {
  GRNID: number;
  GRNNo: string;
  GRNDate: string;
  Status: string;
  SupplierName: string;
  PONumber: string;
}

export interface RecentExpense {
  Eid: number;
  EDocNo: string;
  EDocDate: string;
  EAmount: number;
  EStatus: string;
  EProjectName: string | null;
  EDocumentType: string | null;
  /** "TOD" = direct/Other Expenses booking (no linked PO/GRN/WO). */
  ESourceType: string | null;
  ECreatedAt: string;
  SupplierName: string | null;
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

export interface FollowupTaskSummary {
  id: number;
  taskNo: string;
  subject: string;
  dueDate: string | null;
  status: string;
}

// Sourced from Task Master's /followup-board (already scoped server-side to
// the logged-in user's own assigned tasks) — the old applications/bookings/
// agreements/NOC/handover fields hit routes retired in the Follow-Up module
// cleanup and always 404'd, so this replaces that shape entirely.
export interface FollowupSummaryData {
  totalActive: number;
  overdue: number;
  dueToday: number;
  onHold: number;
  recent: FollowupTaskSummary[];
}

// ─── Aggregated home dashboard shape ─────────────────────────────────────────

export interface SalesSummaryData {
  total: number;
  approved: number;
  pendingApproval: number;
  thisMonthAmount: number;
  totalAmount: number;
}

export interface HomeDashboardData {
  finance: FinanceDashboardData | null;
  material: MaterialDashboardData | null;
  admin: AdminDashboardData | null;
  pendingApprovals: ApprovalInboxItem[];
  recentTasks: TaskSummary[];
  tickets: TicketSummaryData | null;
  engineering: EngineeringSummaryData | null;
  followup: FollowupSummaryData | null;
  sales: SalesSummaryData | null;
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
      thisMonthAmount: raw.paymentsMade?.thisMonthAmount ?? 0,
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
  moduleAccess?: {
    finance?: boolean;
    material?: boolean;
    engineering?: boolean;
    followup?: boolean;
    ticket?: boolean;
    sales?: boolean;
  },
): Promise<HomeDashboardData> {
  const hasFinanceAccess = moduleAccess?.finance ?? false;
  const hasMaterialAccess = moduleAccess?.material ?? false;
  const hasEngineeringAccess = moduleAccess?.engineering ?? false;
  const hasFollowupAccess = moduleAccess?.followup ?? false;
  const hasTicketAccess = moduleAccess?.ticket ?? false;
  const hasSalesAccess = moduleAccess?.sales ?? false;
  const skip = Promise.resolve({ data: null, error: null });

  const baseRequests = [
    hasFinanceAccess
      ? safeFetch<FinanceDashboardApiData>("/api/finance-dashboard")
      : skip,
    hasMaterialAccess
      ? safeFetch<MaterialDashboardData>("/api/material-dashboard")
      : skip,
    safeFetch<ApprovalInboxItem[]>("/api/approval-inbox"),
    safeFetch<{ data: TaskSummary[] }>(
      "/api/tasks?limit=5&sort=dueDate&order=asc",
    ),
    hasTicketAccess
      ? safeFetch<{ counts: Record<string, number | null> }>(
          "/api/tickets/stats",
        )
      : skip,
    hasEngineeringAccess
      ? safeFetch<EngineeringSummaryData>("/api/engineering/dashboard")
      : skip,
    // Task Master's own board feed — already scoped server-side to the
    // logged-in user's assigned tasks (see taskMaster.js's /followup-board).
    hasFollowupAccess
      ? safeFetch<unknown>("/api/task-master/followup-board")
      : skip,
    hasSalesAccess
      ? safeFetch<{ data: any[]; total: number }>("/api/sale-orders?limit=500")
      : skip,
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
    followupBoardRes,
    saleOrdersRes,
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
  if (saleOrdersRes.error) errors.sales = saleOrdersRes.error;
  if (followupBoardRes.error) errors.followup = followupBoardRes.error;

  let tickets: TicketSummaryData | null = null;
  if (!ticketsRes.error && ticketsRes.data) {
    const c = ticketsRes.data.counts ?? {};
    const pending = c.pending ?? 0;
    const inProgress = c.in_progress ?? 0;
    const resolved = c.resolved ?? 0;
    const closed = c.closed ?? 0;
    const total = pending + inProgress + resolved + closed;
    tickets = {
      total,
      pending,
      inProgress,
      resolved,
      closed,
      urgent: c.urgent_open ?? 0,
      high: c.high_open ?? 0,
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

  // Follow-Up (Task Master) — buckets mirror FollowUp.tsx's own dashboard
  // logic: Active tasks split into overdue/due-today/upcoming by DueDate,
  // Hold tasks counted separately.
  const followupTasks: any[] = unwrap(followupBoardRes);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const followupActive = followupTasks.filter((t) => t.Status === "Active" && t.DueDate);
  const followup: FollowupSummaryData = {
    totalActive: followupActive.length,
    overdue: followupActive.filter((t) => new Date(t.DueDate).setHours(0, 0, 0, 0) < todayStart.getTime()).length,
    dueToday: followupActive.filter((t) => new Date(t.DueDate).setHours(0, 0, 0, 0) === todayStart.getTime()).length,
    onHold: followupTasks.filter((t) => t.Status === "Hold").length,
    recent: [...followupTasks]
      .sort((a, b) => new Date(a.DueDate ?? 0).getTime() - new Date(b.DueDate ?? 0).getTime())
      .slice(0, 2)
      .map((t) => ({
        id: t.Id,
        taskNo: t.TaskNo ?? "",
        subject: t.Subject ?? "",
        dueDate: t.DueDate ?? null,
        status: t.Status ?? "",
      })),
  };

  // ── Sales summary
  const soList: any[] = (() => {
    const d = saleOrdersRes.data;
    return Array.isArray(d)
      ? d
      : Array.isArray((d as any)?.data)
        ? (d as any).data
        : [];
  })();
  const soNow = new Date();
  // Use YYYY-MM prefix for safe UTC-safe month comparison
  const soMonthPrefix = `${soNow.getFullYear()}-${String(soNow.getMonth() + 1).padStart(2, "0")}`;
  const sales: SalesSummaryData = {
    total: soList.length,
    approved: soList.filter((o) =>
      (o.Status ?? "").toLowerCase().includes("approved"),
    ).length,
    pendingApproval: soList.filter((o) =>
      ["pending", "draft"].some((s) =>
        (o.Status ?? "").toLowerCase().includes(s),
      ),
    ).length,
    thisMonthAmount: soList
      .filter((o) => {
        const d = o.OrderDate ?? o.CreatedAt ?? "";
        return typeof d === "string" ? d.startsWith(soMonthPrefix) : false;
      })
      .reduce((sum, o) => sum + (Number(o.TotalAmount) || 0), 0),
    totalAmount: soList.reduce(
      (sum, o) => sum + (Number(o.TotalAmount) || 0),
      0,
    ),
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
    sales,
    errors,
  };
}

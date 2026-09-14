import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface WidgetsSummary {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  totalActivity: number;
  activity24h: number;
  activeOperators24h: number;
  totalPayments: number;
  paymentsToday: number;
  paymentAmountTotal: number;
  paymentAmountToday: number;
  pendingCheques: number;
  supplierCount: number;
  customerCount: number;
  ledgerCount: number;
  totalPOs: number;
  openPOs: number;
  openPOValue: number;
  grnsThisMonth: number;
  grnsToday: number;
  totalWorkOrders: number;
  totalTasks: number;
  openTasks: number;
  inProgressTasks: number;
  closedTasks: number;
  reviewedTasks: number;
  overdueTasks: number;
  dueSoonTasks: number;
  totalLeads: number;
  leadsToday: number;
  hotLeads: number;
  activeCampaigns: number;
  activeCrmBookings: number;
  pendingFollowups: number;
  crmCollectionsToday: number;
  crmOverduePayments: number;
  crmPendingCancellations: number;
  crmOpenServiceTickets: number;
  crmSlaBreachedTickets: number;
  crmPendingHandovers: number;
}

export interface WidgetsTrendPoint {
  date: string;
  label: string;
  activityCount: number;
  tasksCreated: number;
}

export interface WidgetUserRecord {
  id: number;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  discontinue: boolean;
}

export interface WidgetActivityRecord {
  id: string;
  userName: string;
  userRole: string;
  event: string;
  actionType?: string | null;
  resource?: string | null;
  details?: string | null;
  createdAt: string;
}

export interface WidgetTaskRecord {
  id: number;
  title: string;
  priority: string;
  status: string;
  dueDate?: string | null;
  createdAt: string;
  assignedToName?: string | null;
  createdByName?: string | null;
}

export interface WidgetPaymentRecord {
  id: number;
  name: string;
  mode?: string | null;
  amount: number;
  date?: string | null;
  createdAt: string;
}

export interface WidgetPurchaseOrderRecord {
  id: number;
  number?: string | null;
  supplierName?: string | null;
  totalAmount: number;
  status?: string | null;
  date?: string | null;
}

export interface WidgetGrnRecord {
  id: number;
  number?: string | null;
  supplierName?: string | null;
  status?: string | null;
  date?: string | null;
}

export interface WidgetAlert {
  type: "critical" | "warning" | "info";
  score: number;
  title: string;
  description: string;
  action?: string;
  count?: number;
}

export interface WidgetInsight {
  title: string;
  description: string;
  change?: number;
}

export interface WidgetsExperience {
  badge: string;
  title: string;
  description: string;
}

export interface WidgetsPermissions {
  canViewUsers: boolean;
  canViewActivity: boolean;
  canViewFinance: boolean;
  canViewProcurement: boolean;
  canViewTasks: boolean;
  canViewAdminTools: boolean;
  canViewCrm: boolean;
}

export interface WidgetQuickAction {
  label: string;
  detail: string;
  path: string;
  icon: string;
}

export interface WidgetModule {
  key: string;
  title: string;
  value: string;
  description: string;
  tone: "emerald" | "amber" | "rose" | "sky" | "slate";
  action?: string;
}

export interface WidgetCatalogItem {
  key: string;
  label: string;
  iconKey: string;
  category: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

export interface WidgetsDashboardData {
  generatedAt: string;
  experience: WidgetsExperience;
  summary: WidgetsSummary;
  trends: {
    dailyFlow: WidgetsTrendPoint[];
  };
  recent: {
    users: WidgetUserRecord[];
    activity: WidgetActivityRecord[];
    tasks: WidgetTaskRecord[];
    payments: WidgetPaymentRecord[];
    purchaseOrders: WidgetPurchaseOrderRecord[];
    grns: WidgetGrnRecord[];
  };
  alerts: WidgetAlert[];
  insights: WidgetInsight[];
  permissions: WidgetsPermissions;
  quickActions: WidgetQuickAction[];
  modules: WidgetModule[];
  meta?: {
    cacheTTL: number;
    role: string;
    scope: "command_center" | "personal_workspace";
    audienceLabel: string;
  };
}


export async function getWidgetsDashboard(): Promise<WidgetsDashboardData> {
  const response = await fetchWithAuth("/api/widgets");

  if (!response.ok) {
    throw new Error("Failed to load widgets dashboard");
  }

  return response.json().catch(() => ({}));
}

export async function getWidgetCatalog(): Promise<WidgetCatalogItem[]> {
  const response = await fetchWithAuth("/api/widgets/catalog");

  if (!response.ok) {
    throw new Error("Failed to load widget catalog");
  }

  return response.json().catch(() => [] as WidgetCatalogItem[]);
}

// ─── Cross-module metrics registry — lets Bar/Line/Pie/Stat Card widgets be
// pointed at real Finance/Material/Engineering/CRM data instead of the one
// fixed dataset getWidgetsDashboard() above returns. See backend/routes/
// widgetMetrics.js for the full catalog and query implementations.

export interface WidgetMetricDef {
  key: string;
  label: string;
  module: string;
  type: "timeseries" | "breakdown" | "stat";
  unit: "currency" | "count";
}

export interface WidgetMetricTimeseries {
  type: "timeseries";
  key: string;
  label: string;
  module: string;
  unit: "currency" | "count";
  labels: string[];
  series: { name: string; data: number[]; color: string }[];
}

export interface WidgetMetricBreakdown {
  type: "breakdown";
  key: string;
  label: string;
  module: string;
  unit: "currency" | "count";
  slices: { name: string; value: number; color: string }[];
}

export interface WidgetMetricStat {
  type: "stat";
  key: string;
  label: string;
  module: string;
  unit: "currency" | "count";
  value: number;
  format: "currency" | "count";
}

export type WidgetMetricData =
  | WidgetMetricTimeseries
  | WidgetMetricBreakdown
  | WidgetMetricStat;

export async function getWidgetMetricsCatalog(): Promise<WidgetMetricDef[]> {
  const response = await fetchWithAuth("/api/widgets/metrics/catalog");

  if (!response.ok) {
    throw new Error("Failed to load widget metrics catalog");
  }

  return response.json().catch(() => [] as WidgetMetricDef[]);
}

export async function getWidgetMetric(key: string): Promise<WidgetMetricData> {
  const response = await fetchWithAuth(`/api/widgets/metrics/${encodeURIComponent(key)}`);

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to load metric "${key}"`);
  }

  return response.json();
}

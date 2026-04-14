import { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReminderItem {
  id: string | number;
  type:
    | "payment"
    | "deadline"
    | "purchase_order"
    | "grn"
    | "cheque"
    | "tds"
    | "task"
    | "general";
  title: string;
  subtitle: string;
  dueDate: string;
  timeSlot?: string;
  urgency: "overdue" | "today" | "soon" | "upcoming";
  amount?: number;
  priority?: "low" | "medium" | "high";
  taskId?: string; // present when type === "task", for direct navigation
}

// ─── Urgency classifier ───────────────────────────────────────────────────────

export function classifyUrgency(dueDateStr: string): ReminderItem["urgency"] {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays <= 7) return "soon";
  return "upcoming";
}

export function formatRelative(dueDateStr: string, timeSlot?: string): string {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);
  const base =
    diffDays < 0
      ? `${Math.abs(diffDays)}d overdue`
      : diffDays === 0
        ? "Today"
        : diffDays === 1
          ? "Tomorrow"
          : `In ${diffDays} days`;
  return timeSlot ? `${base} · ${timeSlot}` : base;
}

// ─── Core fetch ───────────────────────────────────────────────────────────────
// Replaces both fetchAllReminders() in TopNavbar and loadReminders() in MobileNav.
// Tasks are derived from /api/tasks directly — no separate /reminders endpoint.

export async function fetchAllReminders(): Promise<ReminderItem[]> {
  const [poRes, grnRes, chequeRes, tdsRes, taskRes] = await Promise.allSettled([
    fetchWithAuth("/api/purchase-orders"),
    fetchWithAuth("/api/grns"),
    fetchWithAuth("/api/cheque-master"),
    fetchWithAuth("/api/tds-master"),
    fetchWithAuth("/api/tasks?scope=mine&status=open,in_progress"),
  ]);

  const items: ReminderItem[] = [];

  // Purchase Orders
  if (poRes.status === "fulfilled" && poRes.value.ok) {
    const data = await poRes.value.json();
    (Array.isArray(data) ? data : (data.data ?? [])).forEach((po: any) => {
      const d = po.ExpectedDeliveryDate || po.DeliveryDate || po.DocumentDate;
      if (!d) return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `po-${po.Id ?? po.id}`,
        type: "purchase_order",
        title: `PO #${po.PONumber || po.DocumentNumber || po.Id}`,
        subtitle: po.SupplierName || po.VendorName || "Purchase Order",
        dueDate: d,
        timeSlot: po.TimeSlot || po.DeliveryTime || undefined,
        urgency,
        amount: po.TotalAmount || po.Amount || undefined,
      });
    });
  }

  // GRNs
  if (grnRes.status === "fulfilled" && grnRes.value.ok) {
    const data = await grnRes.value.json();
    (Array.isArray(data) ? data : (data.data ?? [])).forEach((grn: any) => {
      const d = grn.ExpectedDate || grn.ReceivedDate || grn.DocumentDate;
      if (!d) return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `grn-${grn.Id ?? grn.id}`,
        type: "grn",
        title: `GRN #${grn.GRNNumber || grn.DocumentNumber || grn.Id}`,
        subtitle: grn.SupplierName || grn.VendorName || "Goods Receipt",
        dueDate: d,
        timeSlot: grn.TimeSlot || undefined,
        urgency,
        amount: grn.TotalAmount || undefined,
      });
    });
  }

  // Cheques
  if (chequeRes.status === "fulfilled" && chequeRes.value.ok) {
    const data = await chequeRes.value.json();
    (Array.isArray(data) ? data : (data.data ?? [])).forEach((chq: any) => {
      const d = chq.ChequeDate || chq.DueDate || chq.Date;
      if (!d) return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `chq-${chq.Id ?? chq.id}`,
        type: "cheque",
        title: `Cheque #${chq.ChequeNumber || chq.Id}`,
        subtitle: chq.BankName || chq.PartyName || "Cheque",
        dueDate: d,
        timeSlot: chq.TimeSlot || undefined,
        urgency,
        amount: chq.Amount || undefined,
      });
    });
  }

  // TDS
  if (tdsRes.status === "fulfilled" && tdsRes.value.ok) {
    const data = await tdsRes.value.json();
    (Array.isArray(data) ? data : (data.data ?? [])).forEach((tds: any) => {
      const d = tds.DueDate || tds.PaymentDate || tds.Date;
      if (!d) return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `tds-${tds.Id ?? tds.id}`,
        type: "tds",
        title: `TDS #${tds.TDSCertificateNo || tds.Id}`,
        subtitle: tds.PartyName || tds.DeducteeName || "TDS Payment",
        dueDate: d,
        timeSlot: tds.TimeSlot || undefined,
        urgency,
        amount: tds.TDSAmount || tds.Amount || undefined,
      });
    });
  }

  // Tasks — derived directly from /api/tasks, no separate endpoint
  if (taskRes.status === "fulfilled" && taskRes.value.ok) {
    const tasks: any[] = await taskRes.value.json();
    tasks.forEach((t: any) => {
      if (!t.dueDate) return;
      const urgency = classifyUrgency(t.dueDate);
      if (urgency === "upcoming") return;
      items.push({
        id: `task-${t.id}`,
        type: "task",
        title: t.title,
        subtitle: `Assigned to ${t.assignedToName}`,
        dueDate: t.dueDate,
        urgency,
        priority: t.priority,
        taskId: String(t.id),
      });
    });
  }

  const ORDER: Record<ReminderItem["urgency"], number> = {
    overdue: 0,
    today: 1,
    soon: 2,
    upcoming: 3,
  };
  items.sort((a, b) => ORDER[a.urgency] - ORDER[b.urgency]);
  return items;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
// Single hook used by TopNavbar, MobileNav, AppSidebar, and FollowupDashboard.
// Handles background polling, manual refresh, and badge count in one place.

interface UseRemindersOptions {
  /** Auto-refresh interval in ms. Default 120_000 (2 min). Set 0 to disable. */
  pollingInterval?: number;
  /** If false, fetch is deferred until refresh() is called manually. Default true. */
  fetchOnMount?: boolean;
}

interface UseRemindersResult {
  reminders: ReminderItem[];
  loading: boolean;
  /** Number of overdue + today items — use for the bell badge. */
  badgeCount: number;
  /** Overdue tasks only — for AppSidebar badge and FollowupDashboard. */
  overdueTaskCount: number;
  /** Trigger a fresh fetch. The refresh button calls this directly. */
  refresh: () => Promise<void>;
  /** True after the first successful fetch. */
  fetched: boolean;
}

export function useReminders(
  options: UseRemindersOptions = {},
): UseRemindersResult {
  const { pollingInterval = 120_000, fetchOnMount = true } = options;

  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const cancelledRef = useRef(false);

  // Guard: never fire any reminder fetch if there is no auth token.
  // Without this, all 5 reminder endpoints fire immediately on app load
  // (before login), get 401s, and trigger fetchWithAuth's redirect → reload
  // → all contexts remount → 401s again → infinite loop.
  const hasToken = useCallback(() => !!localStorage.getItem("token"), []);

  const refresh = useCallback(async () => {
    if (!hasToken()) return; // skip silently if not authenticated
    setLoading(true);
    try {
      const items = await fetchAllReminders();
      if (!cancelledRef.current) {
        setReminders(items);
        setFetched(true);
      }
    } catch {
      // non-critical — bell silently fails
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [hasToken]);

  // Mount fetch
  useEffect(() => {
    cancelledRef.current = false;
    if (fetchOnMount) refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [fetchOnMount, refresh]);

  // Background polling — only while authenticated
  useEffect(() => {
    if (!pollingInterval) return;
    const id = setInterval(() => {
      if (hasToken()) refresh();
    }, pollingInterval);
    return () => clearInterval(id);
  }, [pollingInterval, refresh, hasToken]);

  const badgeCount = reminders.filter(
    (r) => r.urgency === "overdue" || r.urgency === "today",
  ).length;

  const overdueTaskCount = reminders.filter(
    (r) => r.type === "task" && r.urgency === "overdue",
  ).length;

  return { reminders, loading, badgeCount, overdueTaskCount, refresh, fetched };
}

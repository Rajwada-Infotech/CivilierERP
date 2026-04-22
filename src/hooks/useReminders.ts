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

export async function fetchAllReminders(): Promise<ReminderItem[]> {
  const [poRes, grnRes, chequeRes, tdsRes, taskRes] = await Promise.allSettled([
    fetchWithAuth("/api/purchase-orders"),
    fetchWithAuth("/api/grns"),
    fetchWithAuth("/api/cheque-master"),
    fetchWithAuth("/api/tds-master"),
    fetchWithAuth("/api/tasks?scope=mine&status=open,in_progress"),
  ]);

  const items: ReminderItem[] = [];

  // ── Purchase Orders ──────────────────────────────────────────────────────────
  // DB columns: PurchaseOrderID, PurchaseOrderNo, ExpectedDeliveryDate, TotalAmount
  if (poRes.status === "fulfilled" && poRes.value.ok) {
    const data = await poRes.value.json();
    (Array.isArray(data) ? data : (data.data ?? [])).forEach((po: any) => {
      const d = po.ExpectedDeliveryDate || po.PODate;
      if (!d) return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `po-${po.PurchaseOrderID ?? po.Id ?? po.id}`,
        type: "purchase_order",
        title: `PO #${po.PurchaseOrderNo || po.PurchaseOrderID}`,
        subtitle: po.SupplierName || "Purchase Order",
        dueDate: d,
        urgency,
        amount: po.TotalAmount || undefined,
      });
    });
  }

  // ── GRNs ─────────────────────────────────────────────────────────────────────
  // DB columns: GRNID, GRNNo, GRNDate, SupplierID, POID, GRNItems, Status, Remarks, CreatedDate
  if (grnRes.status === "fulfilled" && grnRes.value.ok) {
    const data = await grnRes.value.json();
    (Array.isArray(data) ? data : (data.data ?? [])).forEach((grn: any) => {
      const d = grn.GRNDate || grn.CreatedDate;
      if (!d) return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `grn-${grn.GRNID ?? grn.Id ?? grn.id}`,
        type: "grn",
        title: `GRN #${grn.GRNNo || grn.GRNID}`,
        subtitle: grn.SupplierName || "Goods Receipt",
        dueDate: d,
        urgency,
      });
    });
  }

  // ── Cheques ──────────────────────────────────────────────────────────────────
  // DB columns: CId, CompanyId, BankId, AccountNumber, IFSCCode,
  //             ChequeLotNumber, ChequeStartNumber, ChequeEndNumber,
  //             Remarks, Status, CreatedBy, UpdatedBy, ApprovedBy,
  //             CreatedAt, UpdatedAt, ApprovedAt, TotalCheques
  // NOTE: ChequeMaster has no individual cheque date — skip date-based reminders
  // Only include if Status is 'Pending'
  if (chequeRes.status === "fulfilled" && chequeRes.value.ok) {
    const data = await chequeRes.value.json();
    (Array.isArray(data) ? data : (data.data ?? [])).forEach((chq: any) => {
      // No due date column on ChequeMaster — use CreatedAt as reference
      const d = chq.CreatedAt;
      if (!d) return;
      if (chq.Status !== "Pending" && chq.Status !== "Draft") return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `chq-${chq.CId ?? chq.Id ?? chq.id}`,
        type: "cheque",
        title: `Cheque Lot #${chq.ChequeLotNumber || chq.CId}`,
        subtitle: chq.AccountNumber || chq.BankId || "Cheque",
        dueDate: d,
        urgency,
      });
    });
  }

  // ── TDS ──────────────────────────────────────────────────────────────────────
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
        urgency,
        amount: tds.TDSAmount || tds.Amount || undefined,
      });
    });
  }

  // ── Tasks ────────────────────────────────────────────────────────────────────
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

interface UseRemindersOptions {
  pollingInterval?: number;
  fetchOnMount?: boolean;
}

interface UseRemindersResult {
  reminders: ReminderItem[];
  loading: boolean;
  badgeCount: number;
  overdueTaskCount: number;
  refresh: () => Promise<void>;
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

  const hasToken = useCallback(() => !!localStorage.getItem("token"), []);

  const refresh = useCallback(async () => {
    if (!hasToken()) return;
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

  useEffect(() => {
    cancelledRef.current = false;
    if (fetchOnMount) refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [fetchOnMount, refresh]);

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
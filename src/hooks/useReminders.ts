import { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReminderType =
  | "cheque"
  | "purchase_order"
  | "work_order"
  | "tds"
  | "grn"
  | "payment";

export interface ReminderItem {
  id: string | number;
  type: ReminderType;
  title: string;
  subtitle: string;
  dueDate: string;
  urgency: "overdue" | "today" | "soon" | "upcoming";
  amount?: number;
  meta?: string;
}

// ─── Urgency classifier ───────────────────────────────────────────────────────

export function classifyUrgency(dueDateStr: string): ReminderItem["urgency"] {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays <= 7) return "soon";
  return "upcoming";
}

export function formatRelative(dueDateStr: string): string {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  return `Due in ${diffDays}d`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function fetchAllReminders(): Promise<ReminderItem[]> {
  const [poRes, grnRes, chequeRes, tdsRes, woRes] = await Promise.allSettled([
    fetchWithAuth("/api/purchase-orders"),
    fetchWithAuth("/api/grns"),
    fetchWithAuth("/api/cheque-master"),
    fetchWithAuth("/api/tds-master"),
    fetchWithAuth("/api/work-orders"),
  ]);

  const items: ReminderItem[] = [];

  // Purchase Orders
  if (poRes.status === "fulfilled" && poRes.value.ok) {
    const raw = await poRes.value.json();
    const list: any[] = Array.isArray(raw) ? raw : (raw.data ?? []);
    list.forEach((po: any) => {
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
        meta: po.ProjectName || undefined,
      });
    });
  }

  // GRNs
  if (grnRes.status === "fulfilled" && grnRes.value.ok) {
    const raw = await grnRes.value.json();
    const list: any[] = Array.isArray(raw) ? raw : (raw.data ?? []);
    list.forEach((grn: any) => {
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
        amount: grn.TotalAmount || undefined,
        meta: grn.ProjectName || undefined,
      });
    });
  }

  // Cheques
  if (chequeRes.status === "fulfilled" && chequeRes.value.ok) {
    const raw = await chequeRes.value.json();
    const list: any[] = Array.isArray(raw) ? raw : (raw.data ?? []);
    list.forEach((chq: any) => {
      const d = chq.ChequeDate || chq.MaturityDate || chq.CreatedAt;
      if (!d) return;
      const isActive = chq.Status === 1 || chq.Status === true || chq.Status === "Pending";
      if (!isActive) return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `chq-${chq.CId ?? chq.Id ?? chq.id}`,
        type: "cheque",
        title: `Cheque Lot #${chq.ChequeLotNumber || chq.CId}`,
        subtitle: chq.AccountNumber || "Cheque Lot",
        dueDate: d,
        urgency,
        meta: chq.BankId ? `Bank ${chq.BankId}` : undefined,
      });
    });
  }

  // TDS
  if (tdsRes.status === "fulfilled" && tdsRes.value.ok) {
    const raw = await tdsRes.value.json();
    const list: any[] = Array.isArray(raw) ? raw : (raw.data ?? []);
    list.forEach((tds: any) => {
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

  // Work Orders
  if (woRes.status === "fulfilled" && woRes.value.ok) {
    const raw = await woRes.value.json();
    const list: any[] = Array.isArray(raw) ? raw : (raw.data ?? []);
    list.forEach((wo: any) => {
      const d = wo.DocumentDate || wo.CreatedAt;
      if (!d) return;
      const urgency = classifyUrgency(d);
      if (urgency === "upcoming") return;
      items.push({
        id: `wo-${wo.Id ?? wo.id}`,
        type: "work_order",
        title: `WO #${wo.DocumentNumber || wo.Id}`,
        subtitle: wo.ContractorName || "Work Order",
        dueDate: d,
        urgency,
        amount: wo.TotalAmount || undefined,
        meta: wo.ProjectName || undefined,
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
      // non-critical
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [hasToken]);

  useEffect(() => {
    cancelledRef.current = false;
    if (fetchOnMount) refresh();
    return () => { cancelledRef.current = true; };
  }, [fetchOnMount, refresh]);

  useEffect(() => {
    if (!pollingInterval) return;
    const id = setInterval(() => { if (hasToken()) refresh(); }, pollingInterval);
    return () => clearInterval(id);
  }, [pollingInterval, refresh, hasToken]);

  const badgeCount = reminders.filter(
    (r) => r.urgency === "overdue" || r.urgency === "today",
  ).length;

  return { reminders, loading, badgeCount, refresh, fetched };
}

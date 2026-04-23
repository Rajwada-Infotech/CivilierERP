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
    | "card"
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
  taskId?: string; // present when type === "task"
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

// ─── Role helper (reads from localStorage token payload) ──────────────────────

function getCurrentRole(): string {
  try {
    const token = localStorage.getItem("token");
    if (!token) return "user";
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role ?? "user";
  } catch {
    return "user";
  }
}

function isPrivileged(role: string): boolean {
  return role === "admin" || role === "super_admin" || role === "dba";
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

export async function fetchAllReminders(): Promise<ReminderItem[]> {
  const role = getCurrentRole();
  const privileged = isPrivileged(role);

  // Regular users only see their own tasks — no access to finance/material data
  // Admins/DBA/SuperAdmin see everything including PO, GRN, TDS, cards, cheques
  const baseEndpoints: Promise<Response | null>[] = [
    fetchWithAuth("/api/tasks/reminders"),
  ];

  if (privileged) {
    baseEndpoints.push(
      fetchWithAuth("/api/purchase-orders"),
      fetchWithAuth("/api/grns"),
      fetchWithAuth("/api/card-master"),
      // Cheques: no meaningful due date field exists on ChequeMaster (no ExpiryDate col)
      // so we skip it to avoid false overdue noise from CreatedAt misuse.
      // TDS master stores rate/percentage records, not payment schedules with due dates.
      // Both are excluded until a proper due date column is added to those tables.
    );
  } else {
    // Non-privileged users: push nulls to keep array positions stable
    baseEndpoints.push(
      Promise.resolve(null),
      Promise.resolve(null),
      Promise.resolve(null),
    );
  }

  const [taskRes, poRes, grnRes, cardRes] =
    await Promise.allSettled(baseEndpoints);

  const items: ReminderItem[] = [];

  // ── Tasks (via /api/tasks/reminders) ─────────────────────────────────────
  // Backend returns: { id, taskId, type, title, subtitle, dueDate, urgency, priority }
  // already filtered to open/in_progress within 7 days, scoped by user role.
  if (taskRes.status === "fulfilled" && taskRes.value?.ok) {
    const tasks: any[] = await taskRes.value.json();
    tasks.forEach((t: any) => {
      items.push({
        id: t.id,
        type: "task",
        title: t.title,
        subtitle: t.subtitle,
        dueDate: t.dueDate,
        urgency: t.urgency,
        priority: t.priority,
        taskId: t.taskId ?? String(t.id).replace(/^task-/, ""),
      });
    });
  }

  // ── Purchase Orders (privileged only) ────────────────────────────────────
  // Only show POs that are not yet delivered/cancelled and have a delivery date.
  if (poRes.status === "fulfilled" && poRes.value?.ok) {
    const data = await poRes.value.json();
    (Array.isArray(data) ? data : (data.data ?? [])).forEach((po: any) => {
      // Skip completed/cancelled POs — no action needed
      const status = (po.Status ?? "").toLowerCase();
      if (
        status === "delivered" ||
        status === "cancelled" ||
        status === "closed"
      )
        return;

      const d = po.ExpectedDeliveryDate;
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

  // ── GRNs (privileged only) ────────────────────────────────────────────────
  // GRNs only appear if they are still in Draft/Pending — already received ones
  // don't need attention. GRNDate is the receipt date; only show if it's today or
  // overdue and the GRN is not yet processed.
  if (grnRes.status === "fulfilled" && grnRes.value?.ok) {
    const data = await grnRes.value.json();
    (Array.isArray(data) ? data : (data.data ?? [])).forEach((grn: any) => {
      const status = (grn.Status ?? "").toLowerCase();
      // Only pending/draft GRNs need attention
      if (status !== "draft" && status !== "pending" && status !== "") return;

      const d = grn.GRNDate;
      if (!d) return;
      const urgency = classifyUrgency(d);
      // Only overdue or today — "soon" GRNs are already being processed
      if (urgency !== "overdue" && urgency !== "today") return;
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

  // ── Card Expiry (privileged only) ─────────────────────────────────────────
  // card_master stores expiry_month + expiry_year and reminder_days.
  // We build the actual expiry date here and subtract reminder_days to get
  // the "alert from" date.
  if (cardRes.status === "fulfilled" && cardRes.value?.ok) {
    const data = await cardRes.value.json();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    (Array.isArray(data) ? data : []).forEach((card: any) => {
      if (!card.reminder_enabled) return;
      if (!card.expiry_month || !card.expiry_year) return;
      // Card expires at end of expiry month
      const expiryDate = new Date(
        2000 + parseInt(card.expiry_year, 10),
        parseInt(card.expiry_month, 10), // month+1 day 0 = last day of expiry_month
        0,
      );
      const reminderDays = card.reminder_days ?? 30;
      // The "due date" for reminder purposes = expiry minus reminder_days
      const alertDate = new Date(expiryDate);
      alertDate.setDate(alertDate.getDate() - reminderDays);
      alertDate.setHours(0, 0, 0, 0);

      // Only surface if we're past the alert threshold
      if (today < alertDate) return;

      const urgency = classifyUrgency(expiryDate.toISOString().split("T")[0]);
      // Don't show cards that expired more than 90 days ago (stale noise)
      const daysSinceExpiry = Math.floor(
        (today.getTime() - expiryDate.getTime()) / 86400000,
      );
      if (daysSinceExpiry > 90) return;

      items.push({
        id: `card-${card.id}`,
        type: "card",
        title: `Card Expiry – ${card.card_holder_name || card.bank_name || "Card"}`,
        subtitle: card.bank_name
          ? `${card.bank_name} · ****${String(card.card_number ?? "").slice(-4)}`
          : `****${String(card.card_number ?? "").slice(-4)}`,
        dueDate: expiryDate.toISOString().split("T")[0],
        urgency,
      });
    });
  }

  // Sort: overdue → today → soon → upcoming
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

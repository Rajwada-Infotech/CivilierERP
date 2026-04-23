import { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type ReminderType =
  | "cheque"
  | "purchase_order"
  | "work_order"
  | "tds"
  | "grn";

export interface ReminderItem {
  id: string | number;
  type: ReminderType;
  title: string;
  subtitle: string;
  dueDate: string;
  urgency: "overdue" | "today" | "soon" | "upcoming";
  amount?: number;
  path: string; // Dynamic navigation target
}

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

export function formatRelative(dueDateStr: string): string {
  const due = new Date(dueDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return "Due today";
  return `Due in ${diffDays}d`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

export async function fetchAllReminders(): Promise<ReminderItem[]> {
  const [poRes, grnRes, chequeRes, tdsRes, woRes] = await Promise.allSettled([
    fetchWithAuth("/api/purchase-orders"),
    fetchWithAuth("/api/grns"),
    fetchWithAuth("/api/cheque-master"),
    fetchWithAuth("/api/tds-master"),
    fetchWithAuth("/api/work-orders"),
  ]);

  const items: ReminderItem[] = [];
  const process = async (
    res: PromiseSettledResult<Response>,
    type: ReminderType,
    idKey: string,
    titlePre: string,
    route: string,
  ) => {
    if (res.status === "fulfilled" && res.value.ok) {
      const raw = await res.value.json();
      const list = Array.isArray(raw) ? raw : (raw.data ?? []);
      list.forEach((obj: any) => {
        const d =
          obj.ExpectedDeliveryDate ||
          obj.PODate ||
          obj.GRNDate ||
          obj.ChequeDate ||
          obj.DueDate;
        const recordId = obj[idKey];
        if (!d || !recordId) return;

        const urgency = classifyUrgency(d);
        if (urgency === "upcoming") return;

        items.push({
          id: `${type}-${recordId}`,
          type,
          title: `${titlePre} #${obj.PurchaseOrderNo || obj.GRNNo || recordId}`,
          subtitle: obj.SupplierName || obj.PartyName || "Civilier System",
          dueDate: d,
          urgency,
          amount: obj.TotalAmount || obj.TDSAmount || obj.Amount,
          path: `${route}/${recordId}`,
        });
      });
    }
  };

  await Promise.all([
    process(
      poRes,
      "purchase_order",
      "PurchaseOrderID",
      "PO",
      "/purchase-orders",
    ),
    process(grnRes, "grn", "GRNID", "GRN", "/grns"),
    process(chequeRes, "cheque", "CId", "CHQ", "/cheques"),
    process(tdsRes, "tds", "Id", "TDS", "/tds"),
    process(woRes, "work_order", "Id", "WO", "/work-orders"),
  ]);

  return items.sort((a, b) => {
    const order = { overdue: 0, today: 1, soon: 2, upcoming: 3 };
    return order[a.urgency] - order[b.urgency];
  });
}

export function useReminders(options: { pollingInterval?: number } = {}) {
  const { pollingInterval = 30000 } = options; // Raised from 4s → 30s to reduce noise
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const isFetching = useRef(false);
  const clickCount = useRef(0);
  const lockTimer = useRef<NodeJS.Timeout | null>(null);
  // Consecutive backend-down failures — used for exponential backoff
  const failCount = useRef(0);
  const backoffTimer = useRef<NodeJS.Timeout | null>(null);

  const refresh = useCallback(
    async (isManual = false) => {
      if (isFetching.current || isLocked) return;

      if (isManual) {
        clickCount.current += 1;
        if (clickCount.current > 5) {
          setIsLocked(true);
          if (lockTimer.current) clearTimeout(lockTimer.current);
          lockTimer.current = setTimeout(() => {
            setIsLocked(false);
            clickCount.current = 0;
          }, 5000);
          return;
        }
        setTimeout(() => {
          clickCount.current = 0;
        }, 2000);
      }

      isFetching.current = true;
      if (isManual) setLoading(true);

      try {
        const items = await fetchAllReminders();
        setReminders([...items]);
        // Reset backoff on success
        failCount.current = 0;
      } catch {
        // Count failures — backend may be offline; don't log here (fetchWithAuth already handles it)
        failCount.current += 1;
      } finally {
        setTimeout(() => {
          setLoading(false);
          isFetching.current = false;
        }, 600);
      }
    },
    [isLocked],
  );

  useEffect(() => {
    refresh();

    // Adaptive polling: back off if backend is repeatedly unreachable
    const schedule = () => {
      const delay =
        failCount.current > 3
          ? Math.min(
              pollingInterval * Math.pow(2, failCount.current - 3),
              5 * 60 * 1000,
            ) // max 5 min
          : pollingInterval;

      backoffTimer.current = setTimeout(() => {
        refresh(false).finally(schedule);
      }, delay);
    };

    schedule();

    return () => {
      if (backoffTimer.current) clearTimeout(backoffTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const badgeCount = reminders.filter(
    (r) => r.urgency === "overdue" || r.urgency === "today",
  ).length;
  return { reminders, loading, badgeCount, refresh, isLocked };
}
